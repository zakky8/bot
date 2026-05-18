# CLAUDE.md — TENET Bot Project Instructions

This file is read by Claude (and other AI assistants) before editing this repository. Follow these rules exactly.

---

## What This Project Is

**TENET** — the Astarter community Telegram bot. Production code running on a GCP VM under PM2.

- **Single process:** `tenet-bot` (Node.js + TypeScript via Grammy.js)
- **AI layer:** LangGraph.js 5-node state machine inside the same process
- **LLM:** `openai.gpt-oss-120b-1:0` via AWS Bedrock (eu-north-1)
- **Embeddings:** `amazon.titan-embed-text-v2:0` via AWS Bedrock
- **Storage:** Local JSON vector store (`storage/vectors/vector_db.json`) + Redis sessions + PostgreSQL (optional)

There is **NO separate Python microservice**. Everything runs in `tenet-bot`. Do not propose adding a FastAPI or Python service — the architecture is single-process by design.

---

## Codebase Map

```
bot/
├── telegram-bot/src/
│   ├── ai/agent.ts                   ← LangGraph 5-node state machine (PRIMARY AI)
│   ├── ai/fastPath.ts                ← Canned replies for greetings (no LLM)
│   ├── ai/reranker.ts                ← Cross-encoder chunk rerank
│   ├── ai/verifier.ts                ← Drafter-Critic faithfulness loop
│   ├── ai/responseCache.ts           ← Semantic cache (≥0.94 cosine = instant)
│   ├── commands/ai/chat.ts           ← /ask /ai /support handlers
│   ├── commands/ai/rag.ts            ← /adddoc /docstats /testsearch ops
│   └── commands/                     ← 100+ moderation commands
├── shared/src/services/ai/
│   ├── AIService.ts                  ← Bedrock wrapper + ALLOWED_URLS + INTENT_EXPERT_BLOCKS
│   └── VectorStoreService.ts         ← Local JSON vector store
├── astarter-kb/                      ← Source-of-truth markdown KB
│   └── partnerships.md
├── telegram-bot/faq_data.json        ← Legacy FAQ
└── ecosystem.config.js               ← PM2 config (single process: tenet-bot)
```

---

## Project Facts (Authoritative)

These facts MUST match across `agent.ts`, `AIService.ts`, `faq_data.json`, `astarter-kb/`. If you change one, change all four.

### Active Partnerships (7 as of May 2026)

| # | Partner | Date | URL |
|---|---|---|---|
| 1 | MULAN Labs | May 2026 | https://mulan.meme |
| 2 | PayGo | April 2026 | https://www.paygo.ac |
| 3 | Zeus Network | April 2026 | https://zeusnetwork.xyz |
| 4 | ENI / ENIAC | April 2026 | https://eniac.network |
| 5 | UXLINK | May 2026 | https://uxlink.io |
| 6 | SumPlus | May 2026 | https://www.sumplus.xyz |
| 7 | ANT.FUN | May 2026 | https://ant.fun |

### ABox Node Tiers

| Tier | Price | AA Tokens | Slots |
|---|---|---|---|
| LITE | $500 | 1,333 AA | 12,000 |
| PRO | $1,000 | 2,900 AA | 4,137 |
| MAX | $3,000 | 10,500 AA | 1,142 |
| **Total** | — | — | **17,279** |

Earning: 10% USDT direct referral · 10% Global Board Revenue · 20% of new nodes' daily funds by weight.

### MULAN Points

- Entry: 0.005 BNB → 5,000 points
- Referral: Exchange ASTARTER + refer 1 address → 5,000 points (referral REQUIRES exchanging ASTARTER first — no free referral path)
- NFT star daily earning: 1-STAR 1,298 / 2-STAR 2,900 / 3-STAR 16,000 / 4-STAR 75,000
- Redemption (choose ONE for ALL points): 30% AA pool · 30% Binance-listed pool · independent exchange launch
- **CRITICAL:** The 30% is the size of the token POOL reserved for MULAN holders — NOT a points conversion rate. Always correct users who say "30% of my points convert".
- MULAN Node Revenue Tiers: $100→10% · $500→25% · $1,000→50% trading fee revenue share

### AA Tokenomics

- Supply: 1,000,000,000 AA
- Emission: 250,000 AA/day, −10% every 6 months
- Allocation: Ecosystem 42% · Staking Mining 38% · Market Cap Mgmt 10% · R&D 5% · Node Airdrop 4% · Incentives 1%
- Vesting: 1-year cliff + 4-year linear for team/investors
- TGE: Q2–Q3 2026 target, **NOT confirmed**
- AA price: **NOT published**

### Roadmap

- 2025 Q3–Q4 (DONE): ABox presale, testnet, AI Agents early access
- 2026 Q1–Q2 (NOW): Tokenomics finalized, partnerships, ABox Node Plan + subscription active
- 2026 Q2–Q3 (NEXT): Mainnet + TGE, AI DEX, Prediction Market, Data Market, dev API, Grant Program
- 2026 Q4: Agent App Store, EVM expansion, second node wave
- 2027+: Full Web4 agent autonomy

---

## Rules for Editing This Repo

### Rule 1 — Never Fabricate Facts

If a price, date, percentage, or URL is not in this file, in `astarter-kb/`, or in an official Astarter announcement the user provided — do NOT add it. Ask the user.

### Rule 2 — Sync All 4 Files When Adding/Changing Project Facts

A new partner, tier change, or roadmap update must be updated in:

1. `astarter-kb/<topic>.md` — source of truth
2. `telegram-bot/src/ai/agent.ts` → `SYSTEM_PROMPTS.<intent>` + `INTENT_KEYWORDS` + `ALLOWED_URLS`
3. `shared/src/services/ai/AIService.ts` → `INTENT_EXPERT_BLOCKS` + `INTENT_KEYWORDS` + `ALLOWED_URLS`
4. `telegram-bot/faq_data.json` — FAQ entries
5. `telegram-bot/src/commands/ai/chat.ts` → `LINK_LOOKUP` (only for new official URLs)

Then bump the partnership count number in all places that have a count (currently "7 active partners").

### Rule 3 — URL Allowlist Discipline

Every URL the bot can output must exist in BOTH:
- `telegram-bot/src/ai/agent.ts` → `ALLOWED_URLS`
- `shared/src/services/ai/AIService.ts` → `ALLOWED_URLS`

If a URL is not in the allowlist, `outputCheck` strips it from responses. Adding a partner without updating both ALLOWED_URLS = bot will refuse to share that partner's link.

### Rule 4 — Outreach Goes to Discord, Not Email

Any user question about contacting the team, partnership proposals, AMA requests, technical issues → direct to **https://discord.gg/XXDEjFPrgR** (Astarter Discord ticket system). Never email. Never DMs.

### Rule 5 — Ambiguous Questions Get Clarification, Not Guesses

If a user asks a question with no clear subject ("why can't I see", "it's not working", "my balance"), the bot's instruction is to ASK what they mean — not guess and not default to "not confirmed yet". This is BASE_RULES rule 3 in `agent.ts`.

### Rule 6 — `mulan.meme` Status

`mulan.meme` currently returns 403 when scraped. `https://mulan.lol/` is a DIFFERENT site (Astarter × MULAN airdrop campaign), not a replacement. Keep `mulan.meme` in the data unless the user explicitly confirms it's dead.

### Rule 7 — Model is `openai.gpt-oss-120b-1:0`, Not Nova Lite

Despite earlier mentions of Nova Lite in chat history, the actual model is `openai.gpt-oss-120b-1:0` (OpenAI's open-source model served via AWS Bedrock). Defined in `telegram-bot/src/core/ai.ts` via `AI_MODEL` env var.

### Rule 8 — Architecture is Single-Process

Do not propose adding a Python microservice, FastAPI service, or any separate process. The LangGraph.js architecture runs inside `tenet-bot` and that's intentional. PM2 manages exactly one process.

---

## Deployment

```bash
# On the VM:
cd ~/bot && \
  git pull origin main && \
  npm run build:shared && \
  npm run build:telegram && \
  pm2 restart tenet-bot
```

Watch logs: `pm2 logs tenet-bot`

---

## Testing After Changes

After any change to AI behavior, test these in Telegram:

```
/ask hi                          ← Fast-path (50ms, no LLM)
/ask what is astarter            ← Project intent
/ask is pioneer node worth it    ← Nodes intent + reasoning
/ask 30% mulan                   ← MULAN intent + correct misconception
/ask astarter partners           ← Partnerships intent (lists 7)
/ask ant.fun website             ← LINK_LOOKUP (instant URL reply)
/ask why can't I see             ← Ambiguous → bot should ASK what they mean
/ask how do I contact the team   ← Outreach → bot should give Discord ticket link
```

---

## Common Pitfalls

| Pitfall | Why it breaks things |
|---|---|
| Adding a URL only to one ALLOWED_URLS list | `outputCheck` strips it from output |
| Forgetting to bump the partnership count from N to N+1 | Bot says "6 partners" but lists 7 |
| Adding keywords to one INTENT_KEYWORDS but not the other | Classifier disagrees with expert block |
| Editing `vector_db.json` directly | Use `/adddoc` instead — preserves embeddings |
| Adding a new intent without `INTENT_KEYWORDS` keyword | Classifier falls to `general`, wrong prompt loads |
| Putting facts only in faq_data.json | Agent doesn't read FAQ at runtime — facts must be in agent.ts SYSTEM_PROMPTS |

---

## Maintainer

[@zakky8](https://github.com/zakky8)

Repo: https://github.com/zakky8/bot
