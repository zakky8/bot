# TENET — Astarter Community Telegram Bot

TENET is a moderation + AI assistant Telegram bot for the Astarter Web3 community. It combines a full Telegram moderation toolkit (Grammy.js) with a LangGraph-orchestrated RAG agent backed by AWS Bedrock.

> **Status:** Production. Running on a GCP VM under PM2 as process `tenet-bot`.

---

## What it does

- **AI assistant** — answers community questions about ABox nodes, AA tokenomics, MULAN points, partnerships (MULAN Labs, PayGo, Zeus, ENI/ENIAC, UXLINK, SumPlus, ANT.FUN — 7 active partners), roadmap, team, and developer resources.
- **Knowledge base** — local-JSON vector store powered by AWS Titan embeddings + hybrid cosine/keyword retrieval. Documents can be added live via `/adddoc` (text, URL, PDF, DOCX, TXT, MD, CSV, JSON).
- **Moderation suite** — ban, kick, mute, warn, purge, federation, antiraid, captcha, flood control, blacklist, locks, welcome/goodbye automation, rules, notes, filters (100+ commands inherited from a Grammy moderation base).
- **Smart routing** — every AI question is classified into an intent (`nodes`, `token`, `mulan`, `partnerships`, `roadmap`, `team`, `developers`, `links`, `project`, or `general`), then answered by an intent-specific expert prompt — never with a generic fallback when knowledge exists.
- **Self-defending output** — URL allowlist, identity-leak guard, escalation on negative sentiment, deterministic link lookup that bypasses the LLM for pure URL requests.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Telegram users  (group + DM)                                   │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼ grammy.js
┌─────────────────────────────────────────────────────────────────┐
│  telegram-bot/  (Node 18 + TypeScript)                          │
│  ──────────────                                                 │
│  src/commands/                ← 100+ commands (mod + AI + RAG)  │
│  src/ai/agent.ts              ← LangGraph 5-node state machine  │
│  src/commands/ai/chat.ts      ← /ask /support /ai handlers      │
│  src/commands/ai/rag.ts       ← /adddoc /docstats /testsearch   │
│  src/middlewares/             ← rate-limit, logging, anti-spam  │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  shared/  (npm workspace dependency)                            │
│  ──────────                                                     │
│  src/services/ai/AIService.ts          ← Bedrock wrapper        │
│  src/services/ai/VectorStoreService.ts ← Local JSON vector DB   │
│  src/utils/MemoryRedis.ts              ← Redis fallback shim    │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────┐  ┌──────────────────┐  ┌────────────────┐
│  AWS Bedrock         │  │  Redis           │  │  PostgreSQL    │
│  (eu-north-1)        │  │  (sessions, RL)  │  │  (optional)    │
│  openai.gpt-oss-120b │  │  conv. context   │  │  user/group    │
│  titan-embed-v2      │  │                  │  │  records       │
└──────────────────────┘  └──────────────────┘  └────────────────┘
```

### LangGraph agent (`telegram-bot/src/ai/agent.ts`)

5-node state machine:

```
START → classify → checkSentiment → retrieve → generate → outputCheck → END
                          │
                          └──→ END  (escalation: 2+ negative turns)
```

| Node | Purpose | LLM call? |
|---|---|---|
| `classify` | Keyword-match → intent + sentiment | No (pure regex) |
| `checkSentiment` | Track negatives, escalate at 2 | No |
| `retrieve` | RAG search over vector_db.json with 8s timeout | Titan embed |
| `generate` | Intent-specific expert prompt + retrieved context | gpt-oss-120b |
| `outputCheck` | URL allowlist, identity guard, typo fix | No (pure regex) |

Conversation state is checkpointed in-process via LangGraph `MemorySaver` with `thread_id = tg-{chatId}-{userId}`.

---

## Repository layout

```
bot/
├── README.md                 ← you are here
├── .env.example              ← root env template (used by PM2 from repo root)
├── Dockerfile                ← builds shared lib only
├── package.json              ← workspace root
├── shared/                   ← shared TypeScript lib (workspace)
│   ├── src/services/ai/
│   │   ├── AIService.ts      ← Bedrock + Anthropic clients
│   │   └── VectorStoreService.ts  ← JSON vector store
│   └── src/utils/MemoryRedis.ts
├── telegram-bot/             ← main bot package
│   ├── .env.example
│   ├── src/
│   │   ├── ai/agent.ts       ← LangGraph 5-node agent
│   │   ├── commands/
│   │   │   ├── ai/           ← chat.ts, rag.ts
│   │   │   ├── moderation/   ← ban/kick/mute/warn/purge/...
│   │   │   ├── antispam/     ← antiraid/flood/captcha/locks
│   │   │   ├── federation/   ← cross-chat moderation
│   │   │   ├── greetings/    ← welcome/goodbye
│   │   │   ├── content/      ← notes/filters/rules
│   │   │   ├── admin/        ← promote/demote/setpic/...
│   │   │   ├── fun/          ← hug/pat/slap/roll
│   │   │   └── utility/      ← help/ping/info/aisetup
│   │   ├── core/             ← ai.ts, database.ts, redis.ts
│   │   └── middlewares/      ← rate limit, content, logging
│   ├── faq_data.json         ← legacy FAQ loaded into AIService prompt
│   └── storage/vectors/      ← vector_db.json (runtime)
├── astarter-kb/              ← source-of-truth markdown KB
│   └── partnerships.md       ← all 7 active partnerships
├── docs/
│   ├── COMMANDS.md
│   └── installation/         ← CLOUD.md, VPS.md, LOCALHOST.md
└── scripts/
    ├── deployment/deploy.sh
    └── setup-vm.sh
```

---

## Setup

### Prerequisites

- Node.js 18+
- Redis (or set `REDIS_URL=` empty to use the in-memory fallback)
- AWS account with Bedrock access in `eu-north-1` (or whatever region you set), models `openai.gpt-oss-120b-1:0` and `amazon.titan-embed-text-v2:0` enabled
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Install

```bash
git clone https://github.com/zakky8/bot.git
cd bot

# Install shared lib
cd shared && npm install && npm run build && cd ..

# Install telegram bot
cd telegram-bot && npm install && npm run build && cd ..
```

### Configure

Copy `.env.example` to `.env` at the **repo root** (this is what PM2 reads in production), or to `telegram-bot/.env` for local dev:

```bash
cp .env.example .env
```

Required variables — see `.env.example` for the full list with comments:

| Var | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `BOT_NAME` | Display name in AI replies (default `TENET`) |
| `ADMIN_IDS` | Comma-separated Telegram user IDs |
| `AWS_ACCESS_KEY` | AWS access key for Bedrock |
| `AWS_SECRET_KEY` | AWS secret key for Bedrock |
| `AWS_REGION` | `eu-north-1` (where the models are enabled) |
| `AI_MODEL` | `openai.gpt-oss-120b-1:0` |
| `REDIS_URL` | Optional — `redis://localhost:6379` |
| `HUMAN_MODERATOR_CHAT_ID` | Optional — chat that receives escalations |

> ⚠️ **The env var names above must match exactly** — code reads `AWS_ACCESS_KEY` (not `AWS_ACCESS_KEY_ID`) and `AI_API_KEY` (not `ANTHROPIC_API_KEY`). The `.env.example` files have been corrected to match.

### Run

**Development:**

```bash
cd telegram-bot
npm run dev
```

**Production (PM2):**

```bash
cd telegram-bot
npm run build
pm2 start dist/index.js --name tenet-bot
pm2 save
```

---

## Commands

### AI commands

| Command | Who | What |
|---|---|---|
| `/ask <question>` | Anyone | Ask the bot a question (works in groups & DM) |
| `/support` | Anyone | Tag bot for human help (notifies moderator chat) |
| `/ai` | Group admins | Reply to a user's message — bot answers as if the user asked |
| `/aion` `/aioff` | Group admins | Toggle AI in this chat |

### Knowledge base ops (owner-only)

| Command | What |
|---|---|
| `/adddoc <text>` | Index raw text |
| `/adddoc <URL>` | Scrape + index a webpage (handles HTML, RSS, JSON, Medium) |
| `/adddoc` (reply to file) | Index PDF, DOCX, TXT, MD, CSV, JSON, XML, HTML |
| `/docstats` | Show vector store status |
| `/testsearch <query>` | Test retrieval — shows top-5 chunks + scores |
| `/removedoc <source>` | Remove all chunks from one source |
| `/clearall` | Wipe the vector store |
| `/updatedocs` | Reload `faq_data.json` without restart |

### Moderation commands

Full list in [`docs/COMMANDS.md`](docs/COMMANDS.md). Categories: moderation, antispam, federation, greetings, content (notes/filters/rules), admin, fun, utility.

---

## Deployment

The bot runs on a GCP VM under PM2. Deploy command:

```bash
cd ~/bot && \
  git fetch origin && \
  git reset --hard origin/main && \
  cd shared && npm run build && \
  cd ../telegram-bot && npm run build && \
  pm2 restart tenet-bot
```

Watch logs:

```bash
pm2 logs tenet-bot
```

See [`docs/installation/CLOUD.md`](docs/installation/CLOUD.md) for the full GCP setup.

---

## Active partnerships (7)

| Partner | Type | Announced | Primary URL |
|---|---|---|---|
| **MULAN Labs** | Referral & traffic platform — MULAN points + AA airdrop eligibility | May 2026 | https://mulan.meme |
| **PayGo** | AI-native x402 payment protocol — agent-to-agent payments | April 2026 | https://www.paygo.ac |
| **Zeus Network** | Bitcoin liquidity — zBTC (1:1 BTC-pegged) cross-chain | April 2026 | https://zeusnetwork.xyz |
| **ENI / ENIAC** | Enterprise modular L1 — cross-chain DeFi + co-incubation | April 2026 | https://eniac.network |
| **UXLINK** | Web3 social platform — social growth + on-chain coordination | May 2026 | https://uxlink.io |
| **SumPlus** | DeFi data layer via MCP — AI Agents data vision | May 2026 | https://www.sumplus.xyz |
| **ANT.FUN** | Next-gen Social DEX — ultra-low-rate trading + AI tools | May 2026 | https://ant.fun |

Full details in [`astarter-kb/partnerships.md`](astarter-kb/partnerships.md).

---

## Knowledge base sources

The bot draws facts from three layers, in order of priority:

1. **Retrieved context** — top-5 chunks from `vector_db.json` (added via `/adddoc`)
2. **Intent-specific expert prompts** — hardcoded in `telegram-bot/src/ai/agent.ts` `SYSTEM_PROMPTS`
3. **Legacy FAQ** — `telegram-bot/faq_data.json` (loaded into the legacy `AIService.buildSystemPrompt` for the `/aisetup` health-check path only)

**Source of truth for partnerships and major facts:** `astarter-kb/*.md`. When new facts arrive (new partner, new tier, new milestone), update:

1. `astarter-kb/<topic>.md` — the permanent KB file
2. `telegram-bot/src/ai/agent.ts` → `SYSTEM_PROMPTS.<intent>` and `INTENT_KEYWORDS`
3. `telegram-bot/src/ai/agent.ts` → `ALLOWED_URLS` (if new URLs)
4. `shared/src/services/ai/AIService.ts` → `INTENT_EXPERT_BLOCKS` + `ALLOWED_URLS`
5. `telegram-bot/faq_data.json` (if applicable)

Then build + commit + deploy.

---

## Behaviour guards

Built into BASE_RULES (`agent.ts:174–202`) and deterministic post-processing (`chat.ts`):

- **Rule 3 — Ambiguous & incomplete questions:** if the question has no clear subject, asks about a personal account ("my rewards"), or reports a problem ("not working") → bot asks for clarification instead of guessing.
- **Rule 4 — Outreach & contact:** partnership proposals, AMA requests, pin-post requests, tech issues → always direct to the Astarter Discord ticket system (https://discord.gg/XXDEjFPrgR). Never email, never DMs.
- **Rule 9 — Facts only:** state only what is explicitly written in the intent prompt or retrieved chunks. Never infer plausible-sounding details.
- **Rule 11 — No-answer fallback:** if knowledge is genuinely absent, say "not confirmed yet" + point to announcements channel — but Rules 3 and 4 always take priority.
- **Typo guard:** `Astaster` → `Astarter` corrected automatically in the output node.

---

## Audit findings (May 2026)

Issues identified in a deep audit and the status of each fix:

| Issue | Status |
|---|---|
| Root `faq_data.json` was generic stub data (KYC, withdrawals, VIP) that polluted prompts | ✅ Deleted |
| `.env.example` env var names didn't match code (`AWS_ACCESS_KEY_ID` vs `AWS_ACCESS_KEY`) | ✅ Fixed |
| `AIService.ts` INTENT_KEYWORDS had stale `pioneer`, `alliance` keywords | ✅ Replaced with `lite tier`, `pro tier`, `max tier` |
| `telegram-bot/faq_data.json` had old tier names + `www.astarter.io` + `contact@astarter.io` | ✅ Updated to LITE/PRO/MAX + Discord ticket |
| UXLINK partnership missing from FAQ partners entry | ✅ Added |
| `AIService.ts` line 526 still had `contact@astarter.io` URL rule | ✅ Replaced with Discord ticket earlier |
| `Astaster` typo from model output | ✅ Auto-corrected in outputCheck |
| BASE_RULES had duplicate rule number 4 | ✅ Renumbered (1–15 now) |
| `/ask` with incomplete question fell to "not confirmed" instead of clarification | ✅ Rule 3 expanded |
| Outreach questions (AMA, partnership proposals) hit NO-ANSWER fallback | ✅ Rule 4 added, points to Discord |
| Wrong follow-up appended after Discord ticket responses | ✅ Suppressed in `chat.ts` when Discord+ticket present |

### Known remaining items (non-blocking)

- `AIService.ts` has unused code paths: `gradeChunks`, `listAvailableModels`, `testConnection`, `chatStream`. The LangGraph agent calls only `quickChat`. Safe to remove if/when refactoring AIService.
- Region default is `eu-north-1` in `core/ai.ts` but `us-east-1` in AIService default fallback. Both paths resolve correctly because env always wins, but the inconsistency should be cleaned up.
- `Dockerfile` builds only the shared lib; references a `docker-compose.yml` that lives in `_archive/`. Either update the Dockerfile comment or restore the compose file.
- Generic template content remains in `docs/COMMANDS.md` and `docs/installation/*.md` (mentions "Discord bot", `support@example.com`). These should be rewritten for TENET specifically.

---

## License

Proprietary — internal Astarter tooling. Do not redistribute.

---

## Maintainer

Owner: [@zakky8](https://github.com/zakky8).
