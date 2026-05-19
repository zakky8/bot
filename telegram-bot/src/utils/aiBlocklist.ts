/**
 * Per-user AI blocklist.
 *
 * Stores Telegram user IDs blocked from using /ask and /ai commands.
 * Persists to ai_blocked_users.json alongside bot_admins.json so the
 * block survives bot restarts. Same JSON-array-of-IDs format pattern.
 *
 * Lookups are O(1) via in-memory Set cache (lazy-loaded on first call,
 * invalidated on every write).
 *
 * Blocked users get a silent ignore on /ask and /ai — the bot does not
 * acknowledge the command at all, so the blocked user gets no engagement
 * loop. Admins decide by reading PM2 logs (we can add logging later if
 * needed).
 */

import * as fs from 'fs';
import * as path from 'path';

const BLOCKLIST_FILE = path.join(process.cwd(), 'ai_blocked_users.json');

let cached: Set<number> | null = null;

function load(): Set<number> {
  if (cached) return cached;
  try {
    if (fs.existsSync(BLOCKLIST_FILE)) {
      const raw = fs.readFileSync(BLOCKLIST_FILE, 'utf-8');
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) {
        cached = new Set(ids.map((n: unknown) => Number(n)).filter(n => Number.isFinite(n)));
        return cached;
      }
    }
  } catch (err) {
    console.warn('[aiBlocklist] Failed to load blocklist file:', err);
  }
  cached = new Set();
  return cached;
}

function persist(s: Set<number>): void {
  try {
    fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify([...s], null, 2));
  } catch (err) {
    console.error('[aiBlocklist] Failed to write blocklist file:', err);
  }
}

/** Check if a user ID is blocked from AI commands. Fast — uses in-memory Set. */
export function isAiBlocked(userId: number | undefined | null): boolean {
  if (!userId) return false;
  return load().has(userId);
}

/** Add a user to the blocklist. Returns true if newly blocked, false if already blocked. */
export function blockAiUser(userId: number): boolean {
  const s = load();
  if (s.has(userId)) return false;
  s.add(userId);
  persist(s);
  return true;
}

/** Remove a user from the blocklist. Returns true if unblocked, false if wasn't blocked. */
export function unblockAiUser(userId: number): boolean {
  const s = load();
  if (!s.has(userId)) return false;
  s.delete(userId);
  persist(s);
  return true;
}

/** List all blocked user IDs (returns a copy). */
export function listBlockedAiUsers(): number[] {
  return [...load()].sort((a, b) => a - b);
}

/** Count of currently blocked users. */
export function blockedAiUserCount(): number {
  return load().size;
}
