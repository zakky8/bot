/**
 * Semantic response cache for the TENET /ask handler.
 *
 * Why this exists:
 *   Repeat community questions ("what are the node tiers?", "where can I buy",
 *   "tell me about MULAN") account for a large share of /ask traffic. Each one
 *   currently runs the full LangGraph pipeline (classify → retrieve → generate
 *   → verify → outputCheck) plus a Bedrock LLM call — ~2-5 seconds and ~2k
 *   input tokens per question.
 *
 * What it does:
 *   • Embeds the incoming question with Titan (cached + fast).
 *   • Cosine-matches against every cached question embedding still in TTL.
 *   • If similarity ≥ HIT_THRESHOLD, returns the cached response immediately
 *     (no LLM call, <100ms total).
 *   • Otherwise misses — the agent runs as normal, and the final response is
 *     written back to the cache for the next lookup.
 *
 * Storage:
 *   Redis SET `tenet:rc:keys` holds every active cache key. Per-entry payload
 *   `tenet:rc:e:<uuid>` holds {q, embedding, response, intent, ts}. Both use
 *   the same TTL so they expire together. Capped at MAX_ENTRIES to keep
 *   scanning cheap.
 *
 * What it does NOT cache:
 *   • Escalations (negative sentiment, ESCALATE signal) — these need fresh
 *     moderator routing every time.
 *   • Personal-account questions ("my rewards") — answer text might leak chat
 *     context if served to a different user.
 *   • Very short or very long queries (likely junk or one-off complex asks).
 */

import { MemoryRedis } from '../../../shared';
import { Redis } from 'ioredis';
import { aiService } from '../core/ai';
import { redisClient } from '../core/ai';

type RedisLike = Redis | MemoryRedis;
const r: RedisLike = redisClient;

// ── Tuning ────────────────────────────────────────────────────────────────────
const TTL_SECONDS    = 3600;  // 1 hour — keeps the cache fresh after KB updates
const HIT_THRESHOLD  = 0.94;  // very tight match — avoid serving wrong topic
const MAX_ENTRIES    = 200;   // cap scan cost; oldest pruned on overflow
const MIN_QUERY_LEN  = 8;
const MAX_QUERY_LEN  = 200;
const KEYS_SET       = 'tenet:rc:keys';
const ENTRY_PREFIX   = 'tenet:rc:e:';

interface CacheEntry {
  q: string;
  embedding: number[];
  response: string;
  intent: string;
  ts: number;
}

/** Decide whether a query is eligible for cache lookup/write. */
function isCacheable(query: string, intent?: string): boolean {
  const t = query.trim();
  if (t.length < MIN_QUERY_LEN || t.length > MAX_QUERY_LEN) return false;
  const lower = t.toLowerCase();
  // Skip personal-account questions — answer text is user-specific even if
  // the model says "I can't see your account", the surrounding context
  // shouldn't be served to a different user verbatim.
  if (/\b(my|i have|i got|did i|do i|am i)\b/.test(lower)) return false;
  return true;
}

// ── Fallback / error response detection ───────────────────────────────────────
// These phrases indicate the bot couldn't generate a real answer (timeout,
// throttle, exception). Caching them is POISON — one user's failure becomes
// every similar query's response for the next hour.
//
// Detected on BOTH write (prevent storage) AND read (evict + return cache miss
// so the bot regenerates a real answer instead of serving stale failure).
const FALLBACK_PHRASES: RegExp[] = [
  /\bi'?m having trouble\b/i,
  /\bi had trouble\b/i,
  /\bcouldn'?t generate (a|that|the) response\b/i,
  /\bcouldn'?t generate (a|that|the) reply\b/i,
  /\bsomething went wrong\b/i,
  /\bplease try again( shortly| in a moment)?\b/i,
  /\bi'?m sorry,? but i can'?t help with that\b/i,
  /\btry rephrasing it more simply\b/i,
];

function isFallbackResponse(response: string): boolean {
  return FALLBACK_PHRASES.some(p => p.test(response));
}

/** Look up a cached response by semantic similarity. Returns null on miss. */
export async function lookupCachedResponse(
  query: string,
): Promise<{ response: string; intent: string; score: number } | null> {
  if (!isCacheable(query)) return null;

  const embedding = await aiService.embedQuery(query);
  if (!embedding) return null;

  let keys: string[];
  try {
    keys = await r.smembers(KEYS_SET);
  } catch {
    return null;
  }
  if (keys.length === 0) return null;

  let best: { entry: CacheEntry; score: number } | null = null;

  for (const key of keys) {
    const raw = await r.get(ENTRY_PREFIX + key);
    if (!raw) {
      // Entry expired — drop key from index lazily
      r.srem(KEYS_SET, key).catch(() => {});
      continue;
    }
    let entry: CacheEntry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    const score = aiService.cosine(embedding, entry.embedding);
    if (score > (best?.score ?? 0)) {
      best = { entry, score };
    }
  }

  if (best && best.score >= HIT_THRESHOLD) {
    // Evict + reject if the cached response is a fallback/error message.
    // One previous user's timeout poisoned the cache; serving it to a new
    // user would propagate the failure. Drop the bad entry, force regenerate.
    if (isFallbackResponse(best.entry.response)) {
      // Find the cache ID that owns this entry and evict it
      for (const key of keys) {
        const raw = await r.get(ENTRY_PREFIX + key).catch(() => null);
        if (!raw) continue;
        try {
          const e = JSON.parse(raw) as CacheEntry;
          if (e.q === best.entry.q) {
            r.del(ENTRY_PREFIX + key).catch(() => {});
            r.srem(KEYS_SET, key).catch(() => {});
            break;
          }
        } catch { /* skip */ }
      }
      return null; // force agent regeneration
    }
    return {
      response: best.entry.response,
      intent:   best.entry.intent,
      score:    best.score,
    };
  }
  return null;
}

/** Write a fresh agent response to the cache for future lookups. */
export async function writeCachedResponse(
  query: string,
  response: string,
  intent: string,
): Promise<void> {
  if (!isCacheable(query, intent)) return;
  if (!response || response.length < 20) return; // skip dead-end fallbacks
  // CRITICAL: never cache error/timeout fallback responses. Caching them
  // poisons the cache — one user's failure becomes every similar query's
  // response for the next TTL window. See FALLBACK_PHRASES above.
  if (isFallbackResponse(response)) return;

  const embedding = await aiService.embedQuery(query);
  if (!embedding) return;

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: CacheEntry = {
    q: query.trim().slice(0, MAX_QUERY_LEN),
    embedding,
    response,
    intent,
    ts: Date.now(),
  };

  try {
    await r.setex(ENTRY_PREFIX + id, TTL_SECONDS, JSON.stringify(entry));
    await r.sadd(KEYS_SET, id);

    // Trim oldest entries if cap exceeded (FIFO-ish using ts in entries)
    const count = await r.scard(KEYS_SET);
    if (count > MAX_ENTRIES) {
      // Cheap eviction: trim 10% off, by listing all and dropping oldest
      const all = await r.smembers(KEYS_SET);
      const dated: Array<{ key: string; ts: number }> = [];
      for (const k of all) {
        const raw = await r.get(ENTRY_PREFIX + k);
        if (!raw) {
          r.srem(KEYS_SET, k).catch(() => {});
          continue;
        }
        try { dated.push({ key: k, ts: JSON.parse(raw).ts ?? 0 }); } catch {}
      }
      dated.sort((a, b) => a.ts - b.ts);
      const toDrop = dated.slice(0, Math.max(1, Math.floor(MAX_ENTRIES * 0.1)));
      for (const { key } of toDrop) {
        r.del(ENTRY_PREFIX + key).catch(() => {});
        r.srem(KEYS_SET, key).catch(() => {});
      }
    }
  } catch {
    // Swallow — cache miss next time is harmless
  }
}

/** Owner debug helper — clear the entire response cache. */
export async function clearResponseCache(): Promise<number> {
  try {
    const keys = await r.smembers(KEYS_SET);
    for (const k of keys) {
      await r.del(ENTRY_PREFIX + k);
    }
    await r.del(KEYS_SET);
    return keys.length;
  } catch {
    return 0;
  }
}

/** Owner debug helper — number of cached entries. */
export async function getCacheSize(): Promise<number> {
  try {
    return await r.scard(KEYS_SET);
  } catch {
    return 0;
  }
}
