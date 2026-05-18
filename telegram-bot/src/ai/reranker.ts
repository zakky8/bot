/**
 * Cross-encoder LLM reranker.
 *
 * Pattern (ported from FP-discord/crates/ai/src/pipeline/stage_06_rerank.rs):
 *   Standard hybrid retrieval (Titan-embedding cosine + simple keyword boost)
 *   gives a decent first-pass ranking, but the top-1 chunk is often slightly
 *   off-topic — a paragraph about MULAN tiers when the user asked about node
 *   tiers, or vice versa. Embedding similarity is happy with shared vocabulary.
 *
 *   A cross-encoder judges QUERY ↔ each chunk in a single LLM call and emits
 *   a per-chunk relevance score (0-10). We resort by that score and keep the
 *   top-3. Same chunks, better order. -49% top-3 miss rate per Anthropic's
 *   Contextual Retrieval paper (Sept 2024).
 *
 * Why we skip rerank sometimes:
 *   • 0-1 chunks: nothing to rerank.
 *   • Top score already >0.85: retrieval is confident, reranker won't help.
 *   • Latency budget: rerank is best-effort. On timeout or parse failure we
 *     return the original score-sorted list.
 */

import { aiService } from '../core/ai';

const RERANK_TIMEOUT_MS = 4000;
const TOP_K_OUT = 3;
const MIN_CHUNKS_TO_RERANK = 2;
const SKIP_IF_TOP_SCORE_GTE = 0.85;

export interface RetrievedChunk {
  pageContent: string;
  metadata: any;
  score: number;
}

/**
 * Rerank chunks against the user's query using a single LLM judge call.
 * Returns at most TOP_K_OUT chunks. Falls back to score-sort on any failure.
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  if (chunks.length < MIN_CHUNKS_TO_RERANK) return chunks.slice(0, TOP_K_OUT);

  const topScore = Math.max(...chunks.map(c => c.score));
  if (topScore >= SKIP_IF_TOP_SCORE_GTE) {
    return chunks.slice(0, TOP_K_OUT);
  }

  const sys = `You are a relevance judge. For each CANDIDATE chunk, score how well it answers the QUERY on a 0-10 integer scale:
  10 = directly and completely answers the query
  7  = contains the specific fact needed plus surrounding context
  5  = mentions the topic but not the specific answer
  3  = only tangentially related
  0  = irrelevant

OUTPUT FORMAT (one line per candidate, exact format, no commentary):
[N] <integer 0-10>

Output one line per candidate, in input order. Nothing else.`;

  const truncated = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
  const candidates = chunks
    .map((c, i) => `[${i + 1}]\n${truncated(c.pageContent, 600)}`)
    .join('\n\n');

  const user = `QUERY: ${query}\n\nCANDIDATES:\n${candidates}`;

  let raw: string;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('rerank timeout')), RERANK_TIMEOUT_MS),
    );
    raw = await Promise.race([aiService.quickChat(sys, user, 128), timeout]);
  } catch {
    // Reranker broke — fall back to score-sort
    return [...chunks].sort((a, b) => b.score - a.score).slice(0, TOP_K_OUT);
  }

  // Parse scores
  const scoreByIdx = new Map<number, number>();
  for (const line of raw.split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^\[?(\d+)\]?\s*[:\-]?\s*(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    const s = parseFloat(m[2]!);
    if (Number.isNaN(n) || Number.isNaN(s) || n < 1 || n > chunks.length) continue;
    scoreByIdx.set(n - 1, Math.max(0, Math.min(10, s)));
  }

  if (scoreByIdx.size === 0) {
    return [...chunks].sort((a, b) => b.score - a.score).slice(0, TOP_K_OUT);
  }

  // Resort by reranker score (fall back to original cosine for unscored chunks)
  const enriched = chunks.map((c, i) => ({
    chunk: c,
    rerank: scoreByIdx.get(i) ?? -1,
    cosine: c.score,
  }));

  enriched.sort((a, b) => {
    if (a.rerank !== b.rerank) return b.rerank - a.rerank;
    return b.cosine - a.cosine;
  });

  // Drop clear irrelevants (rerank score 0-2) — even if originally ranked high
  return enriched
    .filter(e => e.rerank >= 3 || e.rerank === -1)
    .slice(0, TOP_K_OUT)
    .map(e => e.chunk);
}
