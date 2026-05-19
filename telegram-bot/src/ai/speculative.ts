/**
 * Speculative RAG drafter-scorer pipeline.
 *
 * Pattern (ported from FP-discord/crates/ai/src/pipeline/speculative.rs):
 *   Standard RAG = 1 big expensive LLM call. Speculative RAG = N cheap parallel
 *   drafters + 1 tiny scorer call. The drafters each see a DIFFERENT subset of
 *   the retrieved chunks (forcing diverse perspectives), then the scorer picks
 *   the best draft using a max_tokens=8 A/B/C call.
 *
 * Published numbers (Wang et al. 2024 "Speculative RAG"):
 *   • -51% latency vs single-shot RAG
 *   • +12.97% accuracy on multi-hop QA benchmarks
 *
 * Why it's faster:
 *   • 3 small drafters in parallel < 1 large single-shot call (wall-clock)
 *   • Scorer is 8 tokens — effectively free
 *
 * Why it's more accurate:
 *   • Each drafter sees only PART of the context → drafts disagree on edge
 *     cases → scorer can spot the most-grounded one
 *   • Drafters with bad chunk subsets produce visibly worse drafts → easy
 *     to reject
 *
 * Trigger gate:
 *   Requires ≥ MIN_CHUNKS_FOR_SPECULATIVE chunks. Below that we don't have
 *   enough material to partition meaningfully — caller falls back to standard
 *   single-shot generate.
 *
 * Failure model:
 *   ANY failure (timeout, parse error, all drafters empty) → return null.
 *   Caller MUST handle null by running standard generate. Speculative RAG is
 *   an OPTIMIZATION, never a hard dependency.
 */

import { aiService } from '../core/ai';

const NUM_DRAFTS = 2;                   // 3→2 to reduce parallel Bedrock pressure (gpt-oss-120b
                                         // throttles aggressively when 3+ concurrent calls fire
                                         // alongside the verifier's parallel claim judges).
const DRAFTER_TIMEOUT_MS = 14000;       // 18→14s — fail faster so the standard-generate fallback
                                         // has headroom before the user's perceived timeout.
const SCORER_TIMEOUT_MS  = 5000;        // scorer is 8 tokens — fast
const DRAFTER_MAX_TOKENS = 768;          // smaller than standard 1024
const SCORER_MAX_TOKENS  = 8;           // single letter only
const MIN_CHUNKS_FOR_SPECULATIVE = 4;   // below this, partitioning is pointless

export interface SpeculativeInput {
  /** Full system prompt (intent prompt + BASE_RULES). */
  systemPrompt: string;
  /** User prompt body (history + language note + user message). NO context block — speculative adds its own per-drafter. */
  userPromptBody: string;
  /** All retrieved chunks (already reranked, top-K). */
  chunks: Array<{ pageContent: string; metadata: any; score: number }>;
}

/**
 * Run speculative RAG. Returns the chosen draft text on success, or null on
 * any failure (caller should fall back to standard generate).
 */
export async function speculativeRAG(input: SpeculativeInput): Promise<string | null> {
  if (input.chunks.length < MIN_CHUNKS_FOR_SPECULATIVE) return null;

  // Partition chunks into NUM_DRAFTS overlapping subsets so each drafter sees
  // a different but coherent view of the evidence.
  const partitions = partitionChunks(input.chunks, NUM_DRAFTS);

  // Diversity hints — each drafter is nudged toward a different style. The
  // scorer then picks whichever style fits the question best.
  const VARIATION_HINTS = [
    'Focus on the SINGLE most directly relevant fact. Prefer brevity.',
    'Give a balanced answer covering the main points. Stay accurate.',
    'Be conservative — only state what is explicitly written in the sources, mark anything uncertain.',
  ];

  // Run all drafters in parallel via Promise.allSettled — one failure
  // doesn't kill the whole speculative path, we just have fewer drafts.
  const drafterResults = await Promise.allSettled(
    partitions.map((partition, i) =>
      runDrafter(
        input.systemPrompt,
        input.userPromptBody,
        partition,
        VARIATION_HINTS[i] ?? VARIATION_HINTS[0]!,
      ),
    ),
  );

  const drafts: string[] = drafterResults
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(d => d && d.trim().length >= 20);

  // Need at least 2 drafts to score meaningfully. Otherwise fall back.
  if (drafts.length < 2) return null;

  // Only 1 surviving draft? Just return it (no need to score).
  if (drafts.length === 1) return drafts[0]!;

  // Score and pick best
  return await scoreDrafts(input.userPromptBody, drafts);
}

/**
 * Partition chunks into N overlapping subsets. Each subset gets ~half the
 * chunks, with overlap between adjacent subsets so no chunk is invisible to
 * all drafters.
 */
function partitionChunks<T>(chunks: T[], n: number): T[][] {
  if (chunks.length <= n) {
    // Few chunks — each drafter sees all of them
    return Array.from({ length: n }, () => [...chunks]);
  }

  const partitionSize = Math.ceil((chunks.length * 2) / n); // roughly half the chunks per drafter
  const stride = Math.max(1, Math.floor((chunks.length - partitionSize) / (n - 1)));

  const result: T[][] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.min(i * stride, chunks.length - partitionSize);
    const end = Math.min(start + partitionSize, chunks.length);
    result.push(chunks.slice(start, end));
  }
  return result;
}

async function runDrafter(
  systemPrompt: string,
  userPromptBody: string,
  chunks: Array<{ pageContent: string }>,
  variationHint: string,
): Promise<string> {
  const context = chunks.map(c => c.pageContent).join('\n---\n');
  const sys = `${systemPrompt}

# Retrieved Context (use ONLY this for facts)
${context}

# Drafter style hint
${variationHint}`;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('drafter timeout')), DRAFTER_TIMEOUT_MS),
  );

  return Promise.race([
    aiService.quickChat(sys, userPromptBody, DRAFTER_MAX_TOKENS),
    timeout,
  ]);
}

/**
 * Pick the best draft. Single LLM call with max_tokens=8 — effectively free.
 * Returns the chosen draft text. Falls back to drafts[0] on any failure.
 */
async function scoreDrafts(userQuery: string, drafts: string[]): Promise<string> {
  const labels = ['A', 'B', 'C', 'D', 'E'].slice(0, drafts.length);
  const numbered = drafts.map((d, i) => `[${labels[i]}]\n${d.trim()}`).join('\n\n---\n\n');

  const sys = `You are a draft scorer. Given a user question and ${drafts.length} candidate answers, pick the SINGLE best one.

Selection priority (in order):
1. Most factually grounded — no inventions, no facts absent from sources
2. Most directly answers the user's question
3. Most concise without losing accuracy
4. Best tone (warm, professional, not robotic)

OUTPUT FORMAT: Reply with EXACTLY one letter (${labels.join(' or ')}) and nothing else. No commentary.`;

  const user = `User question:\n${userQuery.trim().slice(-800)}\n\nCandidates:\n${numbered}\n\nBest letter:`;

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('scorer timeout')), SCORER_TIMEOUT_MS),
    );
    const raw = await Promise.race([
      aiService.quickChat(sys, user, SCORER_MAX_TOKENS),
      timeout,
    ]);

    // Parse the single-letter response. The model may return "A", "[A]",
    // "A.", "**A**", "Letter A", etc. — pull the first valid label.
    const match = raw.match(/[A-E]/i);
    if (!match) return drafts[0]!;

    const idx = labels.indexOf(match[0]!.toUpperCase());
    if (idx === -1) return drafts[0]!;
    return drafts[idx] ?? drafts[0]!;
  } catch {
    // Scorer timeout / error — return first draft as safe fallback
    return drafts[0]!;
  }
}
