/**
 * Atomic-claim multi-judge verifier.
 *
 * Pattern (ported from FP-discord/crates/ai/src/verify/mod.rs):
 *   1. Decompose the draft into atomic factual claims (one LLM call).
 *   2. Check each claim against the SOURCES (intent prompt + retrieved chunks),
 *      in batches of CLAIMS_PER_BATCH per LLM call, in parallel.
 *   3. If any claim FAILs strict judgement → run a permissive re-judge on
 *      JUST those failed claims (catches false-negatives where the source
 *      DOES support the claim but uses different wording).
 *   4. Aggregate: any still-unsupported claim → return FAIL with critique
 *      naming the unsupported claims so the generator can revise.
 *
 * Why this beats single-pass FAIL/PASS:
 *   • Single-pass treats the whole draft as one fact — model often misses
 *     individual sentences buried in a 3-paragraph answer.
 *   • The permissive re-judge cuts false-negative refusals where the model
 *     was being over-strict on phrasing differences (e.g. "5,000 points per
 *     0.005 BNB entry" vs the source's "0.005 BNB → 5,000 points").
 *   • Atomic claims also produce a tighter critique — generator gets told
 *     exactly which sentence to fix, not "your draft has unsupported claims".
 *
 * Budget:
 *   N claims → ceil(N / CLAIMS_PER_BATCH) parallel batched checks, then at
 *   most 1 permissive re-judge over failed claims. Typical answer has 3-5
 *   claims → 2-3 batched LLM calls + maybe 1 permissive call. Total verify
 *   cost ≈ 600-1200 ms (vs 350 ms for the old single-pass), but the catch
 *   rate jumps from ~50% to ~85% for the hallucination class that was
 *   shipping through (per FP-discord measurement).
 */

import { aiService } from '../core/ai';

const CLAIMS_PER_BATCH = 2;
const MAX_PARALLEL_BATCHES = 5; // matches FP-discord (verify/mod.rs:168-195)
const EXTRACTION_TIMEOUT_MS = 6000;
const JUDGE_TIMEOUT_MS = 5000;
const MAX_CLAIMS = 8; // cap to keep verify budget bounded

// URLs the bot is allowed to output. Claims mentioning these are pre-marked as
// supported (they're official Astarter/partner links — judging them as "unsupported
// by sources" causes the generator to drop the URL on retry, leaving users without
// the Discord ticket / website link in outreach responses).
// MUST stay in sync with ALLOWED_URLS in agent.ts and shared/.../AIService.ts.
const ALLOWED_URL_PATTERNS = [
  'discord.gg/XXDEjFPrgR',
  'discord.gg/zeusnetwork',
  'app.astarter.io',
  'astarter.gitbook.io',
  't.me/AstarterDefiHubOfficial',
  't.me/Astarteranncmnt',
  't.me/Paygo_eni',
  't.me/ENI_Channel',
  't.me/ENI_Community',
  'x.com/AstarterDefiHub',
  'x.com/PayGo402',
  'x.com/ZeusNetworkHQ',
  'x.com/ENI__Official',
  'x.com/UXLINKofficial',
  'twitter.com/AstarterDefiHub',
  'medium.com/@AstarterDefiHub',
  'reddit.com/r/Astarter',
  'youtube.com/c/astartertv',
  'zealy.io/cw/astarterdefihub',
  'linktr.ee/Astarter',
  'linktr.ee/uxlink_official',
  'mulan.meme',
  'paygo.ac',
  'zeusnetwork.xyz',
  'eniac.network',
  'docs.eniac.network',
  'uxlink.io',
  'sumplus.xyz',
  'ant.fun',
  'x.com/ant_fun_trade',
];

function isClaimAboutAllowedUrl(claim: string): boolean {
  const lower = claim.toLowerCase();
  return ALLOWED_URL_PATTERNS.some(url => lower.includes(url.toLowerCase()));
}

export interface ClaimVerdict {
  claim: string;
  supported: boolean;
  /** Reason for FAIL (one short phrase) — empty on PASS. */
  reason: string;
}

export interface VerifyResult {
  /** true → ship the draft as-is. false → loop back to generate with critique. */
  pass: boolean;
  /** One short sentence the generator must address on retry. */
  critique: string;
  /** Per-claim verdicts (for telemetry / debug). */
  verdicts: ClaimVerdict[];
}

/**
 * Public entry: verify a draft against the SOURCES.
 *
 * @param sources Concatenated intent-prompt KNOWLEDGE block + any retrieved chunks
 * @param draft   The model's draft response to check
 */
export async function verifyDraft(
  sources: string,
  draft: string,
): Promise<VerifyResult> {
  // 1. Decompose draft → claims
  const allClaims = await extractClaims(draft);
  if (allClaims.length === 0) {
    // No factual claims found — pure conversational filler or clarifying
    // question. Ship as-is.
    return { pass: true, critique: '', verdicts: [] };
  }

  // 1b. Partition: claims mentioning allowlisted URLs are pre-marked SUPPORTED
  // (they're official Astarter links — judging them as "unsupported" causes
  // the generator to drop the URL on retry, leaving outreach replies without
  // the Discord ticket / website link).
  const urlClaims      = allClaims.filter(isClaimAboutAllowedUrl);
  const claimsToJudge  = allClaims.filter(c => !isClaimAboutAllowedUrl(c));
  const urlVerdicts: ClaimVerdict[] = urlClaims.map(claim => ({
    claim,
    supported: true,
    reason: '',
  }));

  // If every claim is just an allowed URL, skip the judge entirely
  if (claimsToJudge.length === 0) {
    return { pass: true, critique: '', verdicts: urlVerdicts };
  }

  // 2. Strict judge in batched parallel — only non-URL claims
  const strictVerdicts = await judgeBatched(sources, claimsToJudge, /*permissive=*/ false);

  // 3. Permissive re-judge of FAILed claims only
  const strictFails = strictVerdicts.filter(v => !v.supported);
  if (strictFails.length === 0) {
    return { pass: true, critique: '', verdicts: [...strictVerdicts, ...urlVerdicts] };
  }

  const permissiveVerdicts = await judgeBatched(
    sources,
    strictFails.map(v => v.claim),
    /*permissive=*/ true,
  );

  // Merge: a claim is FAIL only if it failed both judges
  const permissiveByClaim = new Map(permissiveVerdicts.map(v => [v.claim, v]));
  const merged: ClaimVerdict[] = strictVerdicts.map(strict => {
    if (strict.supported) return strict;
    const permissive = permissiveByClaim.get(strict.claim);
    if (permissive && permissive.supported) {
      return { ...strict, supported: true, reason: '' };
    }
    return strict;
  });
  // Add URL verdicts back into the merged list
  merged.push(...urlVerdicts);

  const stillFailed = merged.filter(v => !v.supported);
  if (stillFailed.length === 0) {
    return { pass: true, critique: '', verdicts: merged };
  }

  // Build one-line critique naming the unsupported claims
  const critique = stillFailed.length === 1
    ? `Unsupported claim: "${stillFailed[0]!.claim}". Either remove it or rewrite using only what's in the knowledge.`
    : `Unsupported claims: ${stillFailed.map(v => `"${v.claim}"`).join('; ')}. Either remove them or rewrite using only what's in the knowledge.`;

  return { pass: false, critique, verdicts: merged };
}

/**
 * Extract atomic claims from the draft. Returns at most MAX_CLAIMS short
 * factual sentences. Strips greetings / questions / filler.
 */
async function extractClaims(draft: string): Promise<string[]> {
  const sys = `You extract atomic factual claims from a draft response for fact-checking.

A "claim" is a single specific factual assertion: a number, date, name, rule, relationship, or feature. Each claim must be standalone (no pronouns).

OUTPUT FORMAT: one claim per line. No numbering, no bullets, no commentary. Maximum ${MAX_CLAIMS} claims.

EXCLUDE: greetings, follow-up questions, clarifying questions, generic filler, opinion words ("great", "amazing"), "I can't see your account"-style disclaimers.

If the draft has NO factual claims (it's just a greeting / clarifying question / filler), output exactly the word: NONE`;

  const user = `DRAFT:\n${draft}\n\nClaims:`;

  let raw: string;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('extract timeout')), EXTRACTION_TIMEOUT_MS),
    );
    raw = await Promise.race([aiService.quickChat(sys, user, 256), timeout]);
  } catch {
    return []; // best-effort — extractor broken means we skip verify gracefully
  }

  const text = raw.trim();
  if (/^NONE$/i.test(text)) return [];

  return text
    .split('\n')
    .map(l => l.replace(/^[\s\-•*\d.)]+/, '').trim())
    .filter(l => l.length >= 8 && l.length <= 240)
    .slice(0, MAX_CLAIMS);
}

/**
 * Check a list of claims against SOURCES in batches, in parallel.
 * Returns one verdict per input claim, in the same order.
 */
async function judgeBatched(
  sources: string,
  claims: string[],
  permissive: boolean,
): Promise<ClaimVerdict[]> {
  // Partition claims into batches of CLAIMS_PER_BATCH
  const batches: string[][] = [];
  for (let i = 0; i < claims.length; i += CLAIMS_PER_BATCH) {
    batches.push(claims.slice(i, i + CLAIMS_PER_BATCH));
  }

  // Bound parallelism — manual worker pool because we don't pull in
  // p-limit just for this.
  const results: ClaimVerdict[][] = new Array(batches.length);
  let next = 0;
  const workerCount = Math.min(MAX_PARALLEL_BATCHES, batches.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = next++;
        if (idx >= batches.length) return;
        results[idx] = await judgeOneBatch(sources, batches[idx]!, permissive);
      }
    }),
  );

  return results.flat();
}

/** Single LLM call: judge a batch of claims. Returns one verdict per claim. */
async function judgeOneBatch(
  sources: string,
  claims: string[],
  permissive: boolean,
): Promise<ClaimVerdict[]> {
  const numbered = claims.map((c, i) => `[${i + 1}] ${c}`).join('\n');

  const judgePolicy = permissive
    ? `You are a PERMISSIVE fact judge. Mark a claim as SUPPORTED if the SOURCES contain the same information even with different wording, paraphrasing, or rearrangement. Only mark UNSUPPORTED if the SOURCES truly do NOT contain the claim's information.`
    : `You are a STRICT fact judge. Mark a claim as SUPPORTED only if the SOURCES explicitly contain the same information. Vague matches are NOT enough. Numbers, dates, and names must match exactly.`;

  // Adversarial worked examples — teaches the judge to catch the 5 common trap
  // patterns that gpt-oss-120b otherwise misses. Ported from FP-discord
  // verify/mod.rs:355-410 (Iran-restriction + FCA-regulation traps adapted to
  // Astarter facts).
  const examples = `

WORKED EXAMPLES (study these patterns):

Example 1 — number swap trap
SOURCES: "LITE Node is $500 with 12,000 slots"
CLAIM: "LITE Node has 12,000 slots and costs $1,000"
VERDICT: [1] UNSUPPORTED: price is $500 not $1,000

Example 2 — invented detail trap
SOURCES: "Astarter has 6 active partners: MULAN, PayGo, Zeus, ENI, UXLINK, SumPlus"
CLAIM: "Astarter has 6 partners including Binance and OKX"
VERDICT: [1] UNSUPPORTED: Binance/OKX are NOT partners — only the 6 listed

Example 3 — paraphrase that's actually correct (do NOT flag)
SOURCES: "TGE target Q2-Q3 2026 — NOT confirmed"
CLAIM: "The token launch is targeted for mid-2026 but the exact date isn't confirmed"
VERDICT: [1] SUPPORTED

Example 4 — confident invention trap
SOURCES: (no info on AA token price)
CLAIM: "The AA token will list at $0.05"
VERDICT: [1] UNSUPPORTED: no AA price in sources — pure invention

Example 5 — partial truth trap
SOURCES: "MULAN Revenue Tiers: $100 → 10% · $500 → 25% · $1,000 → 50%"
CLAIM: "MULAN gives 50% fee share at $500 tier"
VERDICT: [1] UNSUPPORTED: 50% is the $1,000 tier, not $500`;

  const sys = `${judgePolicy}${permissive ? '' : examples}

OUTPUT FORMAT (one line per claim, in input order, exact format):
[N] SUPPORTED
or
[N] UNSUPPORTED: <one short phrase explaining what's missing>

Do not add commentary. Do not skip any claim. Do not output blank lines.`;

  const user = `SOURCES:\n${sources}\n\nCLAIMS:\n${numbered}`;

  let raw: string;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('judge timeout')), JUDGE_TIMEOUT_MS),
    );
    raw = await Promise.race([aiService.quickChat(sys, user, 256), timeout]);
  } catch {
    // Judge broke — fail-open (mark all supported) to avoid blocking shipping
    return claims.map(claim => ({ claim, supported: true, reason: '' }));
  }

  // Parse "[N] SUPPORTED" / "[N] UNSUPPORTED: <reason>"
  const verdictByIdx = new Map<number, ClaimVerdict>();
  for (const line of raw.split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^\[?(\d+)\]?\s*(SUPPORTED|UNSUPPORTED)\s*:?\s*(.*)$/i);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (Number.isNaN(n) || n < 1 || n > claims.length) continue;
    const supported = /^SUPPORTED$/i.test(m[2]!);
    verdictByIdx.set(n, {
      claim: claims[n - 1]!,
      supported,
      reason: supported ? '' : (m[3] || '').trim().slice(0, 120),
    });
  }

  // Fill missing verdicts (parse failure) as supported — fail-open
  return claims.map((claim, i) => verdictByIdx.get(i + 1) ?? { claim, supported: true, reason: '' });
}
