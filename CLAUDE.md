# CLAUDE.md — TENET Bot Monorepo

> **Purpose:** Complete reference for any AI model working on this codebase. Read this before touching any file.

---

## 1. What This Project Is

**TENET** is a production Telegram community bot for the [Astarter](https://app.astarter.io) DeFi project. It does two things:

1. **Community moderation** — ban/kick/mute/warn, anti-spam locks, flood detection, CAPTCHA, federation cross-group bans, welcome/goodbye, content filters, notes/rules.
2. **AI-powered community support** — `/ask` command runs a LangGraph RAG pipeline (classify → retrieve → rerank → generate → verify → output) that answers questions about Astarter products (ABox nodes, AA token, MULAN points, partnerships, roadmap, etc.) using AWS Bedrock.

**Tech stack:** TypeScript · Node 18 · Grammy.js · LangGraph.js · AWS Bedrock (LLM + Titan embeddings) · PostgreSQL · Redis · PM2

---

## 2. Monorepo Layout

```
bot/
├── telegram-bot/          ← Main bot (Grammy.js)
│   ├── src/
│   │   ├── index.ts       ← Entry point, bot init, middleware chain
│   │   ├── core/          ← Infrastructure (AI, DB, Redis, logger)
│   │   ├── ai/            ← LangGraph pipeline (agent, verifier, cache, reranker, fastPath)
│   │   ├── commands/      ← 8 command categories, ~105 commands total
│   │   ├── handlers/      ← Message routing (notes, new members)
│   │   ├── middlewares/   ← Request pipeline (auth, locks, flood, rate-limit, etc.)
│   │   ├── utils/         ← Permissions, user lookup, helpers
│   │   └── types/         ← BotContext, SessionData, enums
│   ├── faq_data.json      ← Knowledge base (embedded into VectorStore on startup)
│   ├── bot_admins.json    ← Bot-level admin user IDs (managed at runtime)
│   ├── ecosystem.config.js← PM2 process config (process name: tenet-bot)
│   └── tsconfig.json
│
├── shared/                ← Shared AI library (used by telegram-bot AND FP-discord)
│   └── src/
│       ├── index.ts       ← Exports AIService + MemoryRedis
│       └── services/ai/
│           ├── AIService.ts         ← Multi-provider LLM abstraction (Bedrock primary)
│           └── VectorStoreService.ts← Hybrid cosine+keyword retrieval
│
├── astarter-kb/           ← Knowledge base documents & partnership notes
├── scripts/               ← DB init, deployment scripts
├── ecosystem.config.js    ← Root PM2 config
└── CLAUDE.md              ← This file
```

---

## 3. Environment Variables

All live in `telegram-bot/.env`. **Never commit `.env`.**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Telegram bot token from @BotFather |
| `BOT_NAME` | ❌ | `TENET` | AI persona name shown in replies |
| `AWS_ACCESS_KEY` | ✅ for AI | — | Bedrock IAM key |
| `AWS_SECRET_KEY` | ✅ for AI | — | Bedrock IAM secret |
| `AWS_REGION` | ❌ | `eu-north-1` | Bedrock region |
| `AI_MODEL` | ❌ | `openai.gpt-oss-120b-1:0` | Bedrock model ID |
| `AI_API_KEY` | ❌ | — | Anthropic direct key (only for `/aisetup` health check) |
| `DATABASE_URL` | ❌ | — | PostgreSQL URL. Bot works without it (no federation/warnings) |
| `REDIS_URL` | ❌ | — | Redis URL. Falls back to in-process MemoryRedis if absent |
| `REDIS_PASSWORD` | ❌ | — | Redis auth |
| `ADMIN_IDS` | ❌ | — | Comma-separated Telegram user IDs with bot-admin rights |
| `OWNER_ID` | ❌ | — | Single owner user ID (all permissions) |
| `HUMAN_MODERATOR_CHAT_ID` | ❌ | — | Chat ID for `/support` escalation notifications |
| `WEBHOOK_URL` | ❌ | — | Set to run webhook mode. Absent = polling mode |
| `PORT` | ❌ | `3000` | Webhook server port |
| `LOG_LEVEL` | ❌ | `info` | Winston log level |

---

## 4. Build & Run

```bash
# Install (from telegram-bot/)
npm install

# Development (hot reload via tsx watch)
npm run dev

# Production build
npm run build          # tsc + copies locales to dist/

# Start compiled
npm start              # node dist/index.js

# Lint / format
npm run lint
npm run format

# Tests
npm test               # jest with coverage
```

**PM2 deploy:**
```bash
pm2 start ecosystem.config.js   # starts "tenet-bot"
pm2 restart tenet-bot            # restart after git pull + build
pm2 logs tenet-bot               # live logs
pm2 save                         # persist across reboots
```

> ⚠️ The PM2 process is named **`tenet-bot`** (check `ecosystem.config.js`). Always use that name for `pm2 restart`.

---

## 5. Entry Point — `src/index.ts`

**Middleware chain (order is critical):**
1. i18n (locale detection)
2. Logging
3. User tracking
4. **Group whitelist** — silently drops messages from unauthorized groups
5. **Auth** — blocks DM access to non-admins
6. **Locks** — enforces content-type restrictions (photo, video, sticker, URL, etc.)
7. **Flood** — per-user message rate enforcement
8. **Content filters** — regex blacklist enforcement
9. Rate limiting (30 msg/60s per user via Redis)

**Dynamic command loading:** Scans all subdirectories under `src/commands/` at startup. Each file exports `default (bot: Bot) => void`.

**Startup modes:**
- `WEBHOOK_URL` set → HTTP server on `PORT`
- No `WEBHOOK_URL` → long-polling (default, more stable for small bots)

**Session storage:** Grammy sessions stored in Redis under `tg:sessions:{chatId}`. Falls back to in-memory if Redis unavailable.

---

## 6. AI Pipeline — Full Architecture

```
User message
     │
     ▼
[fastPath]  ──── greeting/thanks/identity/help? ──→ canned reply → [outputCheck]
     │ miss
     ▼
[response cache]  ──── cosine ≥ 0.94? ──→ cached response → [outputCheck]
     │ miss
     ▼
[classify]   — pure keyword regex → intent (nodes|token|mulan|partnerships|roadmap|team|developers|project|links|general)
     │
     ▼
[checkSentiment]  — 2 consecutive negative turns? → ESCALATE → END
     │ ok
     ▼
[retrieve]   — VectorStore hybrid search (cosine 0.7 + keyword 0.3), score ≥ 0.32 kept
     │
     ▼
[reranker]   — single LLM call scores each chunk 0-10, re-sorts, drops < 3, keeps top-3
     │         (skipped if 0-1 chunks OR top cosine score ≥ 0.85)
     │
     ▼
[generate]   — Bedrock LLM with: intent-specific expert prompt + BASE_RULES + chunks + history + language
     │
     ▼
[verify]     — extract atomic claims → strict judge → permissive re-judge of failures
     │           FAIL → inject critique → loop back to [generate] (max 1 retry)
     │ PASS
     ▼
[outputCheck]  — strip disallowed URLs, fix typos, detect ESCALATE signal, identity leak guard
     │
     ▼
[chat.ts]    — format HTML, inject ANN channel link, Discord URL guard, follow-up question
     │
     ▼
Telegram reply
```

### File-by-file: `src/ai/`

#### `agent.ts` — LangGraph State Machine
- **SYSTEM_PROMPTS**: 10 intent-specific expert knowledge blocks. Each contains `KNOWLEDGE` (facts) + `BEHAVIOUR` (response rules). Edit these to change what the bot knows or how it responds.
- **BASE_RULES**: 15 global rules appended to every prompt (specificity, vague-Q handling, outreach, formatting, facts-only, etc.). Rule 4 controls outreach replies.
- **ALLOWED_URLS**: Set of ~28 URLs that pass the outputCheck URL stripper. **Keep this in sync with `ALLOWED_URL_PATTERNS` in `verifier.ts` and `ALLOWED_URLS` in `AIService.ts`.**
- **INTENT_KEYWORDS**: Keyword→intent map for classify. Pure string `.includes()` — no LLM call.
- **Graph edges**: `verify` loops back to `generate` when `state.critique !== ''`. Capped at 1 retry (`verifyAttempts`).

#### `fastPath.ts` — Canned Replies (Zero LLM Cost)
- Handles greetings, thanks, identity questions, /help — returns constant strings.
- **TOPIC_GUARD** regex: if the message contains any topic keyword (node, mulan, token, partner, discord, etc.), fast path is bypassed regardless of greeting words. Edit this guard if a topic is being incorrectly canned.
- Returns `null` for messages >6 words.

#### `responseCache.ts` — Semantic Cache
- Redis keys: `tenet:rc:keys` (set of IDs) + `tenet:rc:e:<id>` (JSON entries).
- Hit threshold: **0.94** — intentionally tight. Do NOT lower below 0.92 (wrong-topic hits).
- TTL: 3600s. MAX_ENTRIES: 200 (oldest 10% pruned on overflow).
- **Not cached**: personal-account questions (`my`, `I have`, `did I`, etc.), escalations, <8 or >200 char queries.
- Cache is **cleared on bot restart** only if using MemoryRedis. Persists across restarts when Redis is configured.

#### `verifier.ts` — Atomic-Claim Fact Checker
- Extracts up to 8 atomic claims from the draft.
- **ALLOWED_URL_PATTERNS**: Claims about these URLs auto-pass (never judged as unsupported). **Must stay in sync with `ALLOWED_URLS` in `agent.ts`.**
- Two-pass judging: strict first, permissive re-judge on failures only.
- On FAIL: returns `critique` naming unsupported claims → `generate` runs again with that critique injected.
- Fail-open on timeout/parse error (marks claims supported).

#### `reranker.ts` — Cross-Encoder Chunk Sorter
- Single LLM call scores all retrieved chunks 0-10 for query relevance.
- Drops chunks scoring < 3.
- Returns top-3 only.
- Skips if top cosine score already ≥ 0.85 (retrieval confident enough).
- Falls back to original cosine sort on timeout.

---

## 7. Commands — `src/commands/`

| Category | Files | Key Commands |
|---|---|---|
| `moderation/` | 23 cmds | `/ban`, `/kick`, `/mute`, `/warn`, `/purge`, `/pin` |
| `admin/` | 11 cmds | `/promote`, `/demote`, `/setlog`, `/setdesc` |
| `antispam/` | 17 cmds | `/lock`, `/unlock`, `/setflood`, `/blacklist`, `/captcha`, `/antiraid` |
| `greetings/` | 10 cmds | `/setwelcome`, `/setgoodbye`, `/cleanwelcome`, `/welcomemute` |
| `content/` | 13 cmds | `/save`, `/get`, `/notes`, `/filter`, `/rules` |
| `federation/` | 15 cmds | `/newfed`, `/joinfed`, `/fban`, `/fedinfo` |
| `utility/` | 14 cmds | `/start`, `/help`, `/id`, `/stats`, `/connect`, `/settings`, `/aisetup` |
| `ai/` | 2 cmds | `/ask`, `/support` |
| `fun/` | 5 cmds | `/roll`, `/slap`, `/pat`, `/hug` |

**Adding a new command:**
1. Create `src/commands/<category>/mycommand.ts`
2. Export: `export default (bot: Bot<BotContext>) => { bot.command('mycommand', handler) }`
3. It auto-loads on next start — no registration needed.

---

## 8. `src/commands/ai/chat.ts` — The `/ask` Handler

This is where AI responses are sent to Telegram. Key layers (in execution order):

1. **`detectLinkRequest()`** — Deterministic link lookup. If message is asking for a specific link (discord, website, docs, etc.), returns the URL immediately without hitting the AI. Edit `LINK_LOOKUP` to add/remove links.

2. **`lookupCachedResponse()`** — Semantic cache check (≥0.94 hit = instant reply).

3. **`runAgent()`** — Full LangGraph pipeline.

4. **`filterOutput()`** — Identity confession guard (strips "I am Claude/GPT/etc."). URL replacement fixes (docs.astarter.io → linktr.ee).

5. **`formatForTelegram()`** — Converts markdown → Telegram HTML. Strips unsupported tags. Escapes bare `<` that would break Telegram's HTML parser.

6. **Announcements channel injection** — Replaces raw `t.me/Astarteranncmnt` links with `<a href>` tags.

7. **`isOutreachReply` detection + Discord URL guard** — If the response looks like an outreach redirect AND doesn't contain `discord.gg`, appends the ticket URL. Pattern matches: "open a ticket", "official support channel", "reach the team", "astarter discord", "for partnership/AMA/promotion".

8. **Follow-up question injection** — Appends a relevant follow-up question per intent (e.g., "Want pricing, earning, or how to get started?") unless the reply already ends with `?`, has a channel reference, or `isOutreachReply` is true.

---

## 9. Shared Package — `shared/src/services/ai/AIService.ts`

The `AIService` class is the single LLM interface for the entire monorepo. The telegram-bot imports it via `../../../shared`.

**Key methods used in the bot:**
```typescript
aiService.quickChat(systemPrompt, userPrompt, maxTokens)  // Used by verifier, reranker, agent.generate
aiService.embedQuery(query)                                 // Returns number[] (Titan v2 embedding)
aiService.cosine(a, b)                                     // Cosine similarity (0-1)
aiService.searchDocs(query, k, namespaces)                  // Hybrid vector retrieval
aiService.setUserLang(userId, lang)                         // Store language preference
aiService.clearConversationContext(userId, chatId, platform)// Clear history
```

**LLM providers (in priority order):**
1. **AWS Bedrock** (primary) — `AI_MODEL` env var. Default: `openai.gpt-oss-120b-1:0`
2. **Anthropic direct** (fallback) — `AI_API_KEY` env var
3. **Ollama** (local fallback) — `llama3.2:3b` if configured

**Titan embeddings:** `amazon.titan-embed-text-v2:0` — used for both VectorStore indexing and responseCache lookups.

**VectorStore (`VectorStoreService.ts`):**
- Loads `faq_data.json` from the telegram-bot root.
- Embeds all Q+A pairs on first startup, caches to `storage/vectors/`.
- Hybrid retrieval: `0.7 × cosine + 0.3 × keyword_boost`.

---

## 10. Session Data Schema

Session is stored per chat in Redis/memory. Key fields:

```typescript
SessionData {
  // AI
  aiEnabled?: boolean            // false = AI disabled for this group (admin toggle)
  language: string               // Detected language for replies

  // Moderation
  locks: Record<string, { action: LockAction, delete: boolean }>
  warnings: Record<userId, { by, reason, date }[]>
  warnLimit?: number             // Trigger ban/kick/mute after N warns
  warnMode?: 'ban'|'kick'|'mute'

  // Anti-spam
  flood: { limit, interval, action }
  blacklist: string[]
  blacklistMode: 'delete'|'warn'|'mute'|'kick'|'ban'
  captcha: { enabled, mode, text, kickTime }
  antiraid: { enabled, recentJoins: { id, joinedAt }[] }
  approvals: number[]            // Approved user IDs (bypass locks)

  // Content
  notes: Record<key, content>    // #noteName trigger
  filters: Record<pattern, response>
  rules?: string

  // Greetings
  welcomeMessage?: string
  goodbyeMessage?: string
  cleanService?: boolean         // Delete "X joined/left" service messages
  cleanWelcome?: boolean         // Delete previous welcome message when new member joins
  lastWelcomeMsgId?: number

  // Logging
  logChannel?: number            // Channel to mirror mod actions

  // Federation
  federations: { current?: fedId, ...fedData }

  // Remote connection (DM config for groups)
  userData: Record<string, unknown>
}
```

---

## 11. Database Schema (PostgreSQL)

Auto-created on first connect. Only needed for federation and persistent warnings:

```sql
warnings(id, user_id, chat_id, reason, warned_by, created_at)
federations(id, name, owner_id, created_at)
federation_chats(federation_id, chat_id)
federation_bans(federation_id, user_id, reason, banned_by, banned_at)
federation_admins(federation_id, user_id)
```

Bot runs fine without a database — federation commands fail gracefully, warnings fall back to session.

---

## 12. Permissions System

```
Priority: OWNER_ID > ADMIN_IDS (env) > bot_admins.json > Telegram group admins > everyone
```

- **`isOwner(ctx)`** — checks `OWNER_ID` env.
- **`isBotAdmin(ctx)`** — checks `ADMIN_IDS` env + `bot_admins.json`.
- **`isAdminOrOwner(ctx)`** — for groups, also calls `getChatAdministrators` (5-min cache).
- **Anonymous admin** (ID `1087968824`) — Telegram's "hide my identity" feature. Always treated as admin.
- **`/connect`** — lets bot admins configure a group from DM by routing context through the remote group ID.

---

## 13. Middleware: Group Whitelist

Groups must be explicitly authorized before the bot responds. Flow:

1. When bot is added to a group → checks whitelist → if not authorized, DMs owner + leaves.
2. Every incoming message → `groupWhitelistMiddleware` → unauthorized groups get silent drop (no reply, no error).
3. Owner/bot-admins bypass the whitelist automatically.
4. `/addgroup` command (owner-only) adds the current group to the whitelist.

Whitelist persists in session/file. Edge case: **`/addgroup` command always bypasses the middleware** so the owner can authorize from inside the group.

---

## 14. Content Locks

Lock types (25+) and their enforcement:

| Type | Blocks |
|---|---|
| `photo`, `video`, `audio`, `voice`, `document`, `sticker`, `animation`, `video_note` | Media messages |
| `url` | Messages with URLs |
| `command` | Bot commands from non-admins |
| `forward` | Forwarded messages |
| `invitelink` | Messages with invite links |
| `inline` | Via-bot inline messages |
| `bot` | New bots being added |
| `keyboard` | Messages with reply keyboards |
| `premium_emoji` | Premium Telegram emoji |
| `poll`, `dice`, `game`, `location`, `contact`, `payment`, `giveaway`, `story` | Specific content types |

**Lock actions:** `off` (disabled) · `warn` · `mute` · `kick` · `ban`. Plus optional `delete`.

Admins and approved users (`/approve`) are immune to all locks.

---

## 15. Key Files to Know When Making Changes

| Want to... | Edit this file |
|---|---|
| Change what the bot *knows* about a topic | `src/ai/agent.ts` → `SYSTEM_PROMPTS[intent]` |
| Change how the bot *behaves* globally | `src/ai/agent.ts` → `BASE_RULES` |
| Add a new AI intent/topic | Add keyword to `INTENT_KEYWORDS`, add entry to `SYSTEM_PROMPTS` |
| Change which URLs are allowed in output | `ALLOWED_URLS` in `agent.ts` AND `ALLOWED_URL_PATTERNS` in `verifier.ts` |
| Add a partner link to deterministic lookup | `LINK_LOOKUP` array in `src/commands/ai/chat.ts` |
| Change follow-up questions per intent | `FOLLOWUPS` object in `src/commands/ai/chat.ts` |
| Change outreach reply detection | `isOutreachReply` regex in `src/commands/ai/chat.ts` |
| Add a greeting/thanks token | `GREETING_TOKENS` / `THANKS_TOKENS` in `src/ai/fastPath.ts` |
| Add a topic guard keyword | `TOPIC_GUARD` regex in `src/ai/fastPath.ts` |
| Change cache hit threshold | `HIT_THRESHOLD` in `src/ai/responseCache.ts` (don't go below 0.92) |
| Change verifier strictness | Prompt in `judgeOneBatch()` in `src/ai/verifier.ts` |
| Add a new bot command | Create `src/commands/<category>/name.ts`, export default function |
| Change lock behavior | `src/middlewares/locks.ts` |
| Change flood threshold | `/setflood` command (stored in session) or `src/middlewares/flood.ts` |
| Update the knowledge base | Edit `faq_data.json` → delete `storage/vectors/` → restart (re-embeds) |

---

## 16. Common Gotchas

### URL allow-lists are triplicated
Three places must stay in sync whenever you add a new partner/official URL:
1. `agent.ts` → `ALLOWED_URLS` (output stripper)
2. `verifier.ts` → `ALLOWED_URL_PATTERNS` (claim pre-approver)
3. `AIService.ts` → its own allowed-URL set

### Cache survives restarts (when Redis is live)
After updating prompts/knowledge, the old answers may still be served from cache for up to 1 hour. Force-clear with `/stats` → clear option, or flush the `tenet:rc:*` Redis keys manually.

### `faq_data.json` changes need vector cache deletion
After editing `faq_data.json`, delete `storage/vectors/` so the bot re-embeds everything on next startup.

### Process name vs config name
`ecosystem.config.js` in the root sets name to `telegram-bot`. The `ecosystem.config.js` inside `telegram-bot/` sets it to `tenet-bot`. Always check which one is active: `pm2 list`.

### Telegram HTML format — NOT markdown
The bot outputs `<b>`, `<i>`, `<code>`, `<a href="...">` only. Never `**bold**`, `_italic_`, `[text](url)`. The formatter in `chat.ts` converts common markdown patterns, but the AI system prompts explicitly say "Telegram HTML only."

### LangGraph MemorySaver is in-process
Conversation history (`state.history`) lives in RAM only. It resets on every `pm2 restart`. This is intentional — history is capped at 20 messages anyway.

### Session vs Database warnings
`/warn` writes to both the session AND the `warnings` DB table if DATABASE_URL is set. If no database, warnings only persist as long as the Redis session lives (they survive restarts with Redis but are lost with MemoryRedis).

### `verifyAttempts` cap
The verify→generate loop is hard-capped at **1 retry** (max 2 total generate calls). This is `if (verifyAttempts >= 1) return { critique: '' }` in `verify()`. Don't increase this without measuring latency impact.

### Rate limit: Redis required for accuracy
`rateLimit.ts` uses Redis `INCR`+`EXPIRE`. If Redis is unavailable, it fails open (allows all messages). MemoryRedis works fine for single-instance deployments.

### Anonymous group admin ID
Telegram's "hide my identity" group admin feature sends messages as user ID `1087968824`. This is hardcoded in multiple permission checks. Don't remove it.

---

## 17. AI Response Quality Rules (Enforce These)

These are the hardcoded constraints in `BASE_RULES` and the intent prompts. Any change to these rules has direct community impact:

1. **SPECIFICITY** — Only answer what was asked. Never volunteer extra sections.
2. **VAGUE QUESTIONS** — One-sentence overview + ask which aspect they want. Never dump a full data sheet.
3. **AMBIGUOUS** — Three patterns need clarification before answering: no-object references ("it/this"), personal-account questions ("my rewards"), problem reports ("not working").
4. **OUTREACH** — Acknowledge the specific inquiry type, direct to Discord ticket (https://discord.gg/XXDEjFPrgR). URL must always appear. Vary phrasing. Never suggest DMs/PMs.
5. **FACTS ONLY** — Only state what's explicitly in the knowledge blocks. No inference, no plausible-sounding fills.
6. **NO ANSWER** — Route to announcements channel ONLY for timing questions ("when will X launch"). For policy/feature unknowns, route to Discord ticket.
7. **FORMAT** — Max 120 words. Bullets (•) only for 3+ parallel items. `<b>` for key terms only.
8. **IDENTITY** — Never reveal the underlying model. Always "I'm TENET."
9. **LANGUAGE** — Auto-detect and match user's language.

---

## 18. Astarter Knowledge Reference

Quick reference for AI prompt correctness:

| Topic | Key Facts |
|---|---|
| **ABox Nodes** | LITE $500/1,333 AA/12,000 slots · PRO $1,000/2,900 AA/4,137 slots · MAX $3,000/10,500 AA/1,142 slots. Total 17,279 slots. Revenue sharing. |
| **AA Token** | 1B supply. 250,000 AA/day emission, −10% every 6 months. 1-year cliff + 4-year linear vesting. TGE Q2–Q3 2026 (NOT confirmed). |
| **MULAN** | Entry 0.005 BNB → 5,000 points. Revenue tiers: $100→10%, $500→25%, $1,000→50%. NFT daily: 1★ 1,298/2★ 2,900/3★ 16,000/4★ 75,000 pts/day. |
| **Partners (6)** | MULAN Labs (May 2026) · PayGo (Apr 2026) · Zeus Network (Apr 2026) · ENI/ENIAC (Apr 2026) · UXLINK (May 2026) · SumPlus (May 2026) |
| **Roadmap** | Done: ABox presale, testnet, AI Agents early access. Now: partnerships, node subscriptions. Next Q2–Q3 2026: mainnet + TGE, DEX, Prediction Market. |
| **Team** | Community-driven. Lead investors: OKX Ventures, EMURGO. |
| **Official Discord** | https://discord.gg/XXDEjFPrgR (ticket system for support/outreach) |
| **Dead products** | Cardano launchpad, IDO, Astarter Swap, Money Market, ADA pools, ISPO, AA1 staking — NEVER present as current |

---

## 19. Deployment Checklist

When pushing changes that affect AI behavior:

- [ ] Update `ALLOWED_URLS` in `agent.ts` if adding a partner link
- [ ] Update `ALLOWED_URL_PATTERNS` in `verifier.ts` to match
- [ ] Update `LINK_LOOKUP` in `chat.ts` if adding a deterministic link shortcut
- [ ] Update `TOPIC_GUARD` in `fastPath.ts` if adding a new topic keyword
- [ ] Delete `storage/vectors/` if `faq_data.json` was changed
- [ ] Run `npm run build` — zero TypeScript errors required
- [ ] `git push origin main`
- [ ] On server: `git pull && npm run build && pm2 restart tenet-bot --update-env`
- [ ] Monitor first few `/ask` responses for correctness
- [ ] If responses are stale (cache hits from old prompts): flush `tenet:rc:*` in Redis

---

## 20. Sibling Project: FP-discord (Rust)

Located at `fundingpips-bot/` in the monorepo. This is a separate Rust Discord bot for FundingPips. Many AI pipeline patterns in the TypeScript bot were **ported from FP-discord's Rust implementation**:

- `fastPath.ts` ← `crates/ai/src/pipeline/fast_path.rs`
- `reranker.ts` ← `crates/ai/src/pipeline/stage_06_rerank.rs`
- `verifier.ts` ← `crates/ai/src/verify/mod.rs`

When the Rust bot gets a new pattern improvement, consider porting it here. The two codebases share the same architectural thinking but are deployed independently.
