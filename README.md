# Super Bot — Advanced Multi-Platform Bot System with RAG

> Production-ready multi-platform bot system for **Telegram** and **Discord** — combining 159 moderation/management commands with **Sophisticated RAG (Retrieval-Augmented Generation)** support automation. Both bots share a single **AWS Bedrock** powered AI service with persistent vector embeddings, automated hallucination checks, document indexing (PDF/URL), conversation memory, and human escalation.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Claude AI](https://img.shields.io/badge/Claude-claude--sonnet--4--6-orange)
![CI](https://github.com/zakky8/super-bot/actions/workflows/check.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Table of Contents

- [Overview](#overview)
- [Repository Structure](#repository-structure)
- [AI System — Anthropic Claude](#ai-system--anthropic-claude)
  - [How It Works](#how-it-works)
  - [AI Commands](#ai-commands)
  - [FAQ Knowledge Base](#faq-knowledge-base)
  - [Prompt Injection Protection](#prompt-injection-protection)
  - [Conversation Memory](#conversation-memory)
  - [Human Escalation](#human-escalation)
  - [Rate Limiting](#rate-limiting)
  - [Ollama Fallback](#ollama-fallback)
- [Telegram Bot — 104 Commands](#telegram-bot--104-commands)
- [Discord Bot — 55 Commands](#discord-bot--55-commands)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Docker Deployment](#docker-deployment)
- [PM2 Production Deployment](#pm2-production-deployment)
- [CI/CD](#cicd)
- [Related Repositories](#related-repositories)

---

## Overview

Super Bot is a production-grade, multi-platform bot system designed for communities that need both powerful moderation tooling and AI-powered support automation. The system consists of three packages:

| Package | Framework | Commands | Role |
|---|---|---|---|
| `telegram-bot` | Grammy (TypeScript) | 104 | Full MissRose-parity Telegram bot |
| `discord-bot` | Discord.js (TypeScript) | 55 | Full MEE6-parity Discord bot |
| `shared` | TypeScript library | — | Shared AI service, DB models, Redis utils |

Both bots import the same `AIService` from `shared/`, ensuring identical AI behaviour, rate limits, and conversation memory across platforms.

---

## Repository Structure

```
super-bot/
├── .github/
│   └── workflows/
│       └── check.yml          # CI: type-check + tests (shared → telegram → discord)
├── shared/                    # Shared TypeScript library
│   ├── src/
│   │   ├── index.ts           # Public exports
│   │   ├── services/
│   │   │   └── ai/
│   │   │       └── AIService.ts   # Core AI service (Anthropic + Ollama)
│   │   ├── database/
│   │   │   ├── index.ts
│   │   │   ├── migrations/
│   │   │   └── models/
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── MemoryRedis.ts     # In-memory Redis fallback
│   │       └── index.ts
│   ├── tests/
│   │   └── AIService.test.ts  # 7 unit tests
│   ├── jest.config.js
│   ├── package.json
│   └── tsconfig.json          # composite: true (project references)
│
├── telegram-bot/              # Grammy-based Telegram bot
│   ├── src/
│   │   ├── index.ts
│   │   ├── core/
│   │   │   └── ai.ts          # AIService factory + reinitialise
│   │   ├── commands/
│   │   │   ├── admin/         # 11 commands
│   │   │   ├── ai/            # chat.ts (+ /ask /support)
│   │   │   ├── antispam/      # 17 commands
│   │   │   ├── content/       # 13 commands
│   │   │   ├── federation/    # 15 commands
│   │   │   ├── fun/           # 5 commands
│   │   │   ├── greetings/     # 10 commands
│   │   │   ├── moderation/    # 22 commands
│   │   │   └── utility/       # aisetup + 10 utility commands
│   │   ├── handlers/
│   │   ├── locales/
│   │   ├── middlewares/
│   │   ├── types/
│   │   └── utils/
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── discord-bot/               # Discord.js-based Discord bot
│   ├── src/
│   │   ├── index.ts
│   │   ├── core/
│   │   │   └── ai.ts          # AIService factory
│   │   ├── commands/
│   │   │   ├── ai/            # chat.ts
│   │   │   ├── custom/        # 5 commands
│   │   │   ├── engagement/    # 7 commands
│   │   │   ├── leveling/      # 12 commands
│   │   │   ├── moderation/    # 16 commands
│   │   │   ├── reactionroles/ # 4 commands
│   │   │   ├── social/        # 4 commands
│   │   │   └── utility/       # 7 commands
│   │   ├── events/
│   │   ├── types/
│   │   └── utils/
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── faq_data.json              # FAQ knowledge base (edit to customise AI answers)
├── docker-compose.yml         # Full stack: bots + Postgres + Redis
├── ecosystem.config.js        # PM2 process manager config
├── Dockerfile                 # Root build image
├── .env.example               # Root environment template
└── CHANGELOG.md
```

---

---

## AI System — AWS Bedrock RAG

Both bots use the same `AIService` from `shared/src/services/ai/AIService.ts`. The system has been upgraded from simple FAQ lookups to a full **Retrieval-Augmented Generation (RAG)** pipeline.

### How It Works (RAG Pipeline)

```mermaid
graph TD
    A[User Message] --> B[Similarity Search]
    B --> C[Fetch relevant chunks from Vector DB]
    C --> D[Inject Context into Prompt]
    D --> E[Sanitize & Rate Limit]
    E --> F[Generate with AWS Bedrock]
    F --> G[Hallucination Check]
    G -- "Factual" --> H[Save Context & Reply]
    G -- "Hallucinated" --> F
```

### Feature Summary

| Feature | Detail |
|---|---|
| **Primary AI** | AWS Bedrock (Claude 3 / Mistral / Titan) |
| **RAG Knowledge Base** | Persistent Vector Store via local JSON DB + Titan Embeddings |
| **Document Indexing** | Support for PDFs, TXT files, and Web Scraping (with Medium bypass) |
| **Hallucination Check** | Post-generation self-reflection step to ensure factual accuracy |
| **Prompt Injection Guard** | 8 blocked phrases to prevent system prompt leaking |
| **Input Cap** | Messages truncated at 1,000 characters for safety |
| **Human Escalation** | AI returns `ESCALATE` → bot notifies moderator channel |
| **Conversation Memory** | Last 20 messages stored in Redis per user per chat |
| **Rate Limiting** | 20 requests per hour per user (Redis-backed) |

### AI Commands

**Telegram:**

| Command | Description |
|---|---|
| `/chat <message>` | Ask the AI — contextually grounded in your Knowledge Base |
| `/aion` / `/aioff` | Enable or disable the AI for the current group (Admin Only) |
| `/adddoc <url/text>` | Index a website or text note into the Vector DB |
| `/adddoc (reply)` | Reply to a PDF or TXT file with this to index it |
| `/removedoc <name>` | Delete a specific document from the Knowledge Base |
| `/docstats` | View current Knowledge Base status and statistics |
| `/clearall` | Completely reset the Knowledge Base (Owner Only) |
| `/support <issue>` | Escalate directly to a human moderator |
| `/aisetup status` | Show current AI configuration and provider status |
| `/aisetup test` | Send a live test message and report latency |

**Discord:**

| Command | Description |
|---|---|
| `/chat message:<text>` | Ask Claude AI — FAQ-constrained answers |
| `/chat clear:true` | Reset your conversation history |

### FAQ Knowledge Base

Edit `faq_data.json` at the project root to control what the AI knows:

```json
[
  {
    "q": "How do I reset my password?",
    "a": "Go to the login page and click 'Forgot Password'. Enter your email and follow the reset link."
  },
  {
    "q": "What are the trading fees?",
    "a": "Trading fees are 0.1% per trade. VIP members receive reduced fees."
  }
]
```

- The AI is **constrained to answer only from this file**
- Questions not in the FAQ trigger an automatic **ESCALATE** signal
- Changes take effect immediately via `/aisetup faq` (Telegram) — no restart needed
- Loaded from `faq_data.json` at the repo root; falls back to `process.cwd()/../faq_data.json`

### Prompt Injection Protection

The following phrases are blocked at the input sanitization layer. Any message containing them is replaced with a neutral fallback before reaching the AI:

```
ignore previous instructions   |   ignore all previous
forget your instructions        |   you are now
act as if                       |   jailbreak
reveal your system prompt       |   what are your instructions
```

All injection attempts are logged with the matched phrase for audit purposes.

### Conversation Memory

- Stored in **Redis** with key pattern `ai:conversation:{platform}:{chatId}:{userId}`
- Automatically falls back to **in-memory** (`MemoryRedis`) if Redis is unavailable
- **Last 20 messages** (10 turns) are kept per user — older messages are pruned on save
- TTL: **1 hour** (resets on every interaction)
- Users can clear their history with `/chat clear` (Telegram/Discord)

### Human Escalation

When Claude cannot answer a question from the FAQ, it returns the exact string `ESCALATE`. The AI service detects this and:

1. Sets `response.isEscalation = true`
2. Replaces the content with a user-facing message: _"I couldn't find an answer in my knowledge base. A human moderator has been notified and will follow up shortly."_
3. The bot command handler sends an alert to the configured moderator channel/chat

**Telegram** — set `HUMAN_MODERATOR_CHAT_ID` in `.env`:
```
The bot forwards the user's question to the moderator chat via ctx.api.sendMessage()
```

**Discord** — set `HUMAN_MODERATOR_CHANNEL` in `.env`:
```
The bot sends an orange embed to the moderator channel via channel.send()
```

Users can also trigger escalation directly with `/support <issue>` (Telegram).

### Rate Limiting

- **20 requests per hour** per user (configurable via `AIConfig.rateLimit`)
- Stored in Redis with key `ai:ratelimit:{userId}`, TTL = window size
- When the limit is hit the bot replies with a clear retry message
- Falls back to in-memory if Redis is unavailable

### Ollama Fallback

If the Anthropic API call fails for any reason (network issue, quota exceeded, etc.), the service automatically retries with a local **Ollama** model:

- Default Ollama model: `llama3.2:3b`
- Configure host via `OLLAMA_HOST` (default: `http://localhost:11434`)
- Both failure attempts are logged at `warn` / `error` level
- If both providers fail, a clear error is returned to the user

---

## Telegram Bot — 104 Commands

Built with **Grammy** (TypeScript). Full MissRose feature parity.

### Moderation — 22 commands

| Command | Description |
|---|---|
| `/ban` | Ban a user from the group |
| `/unban` | Remove a user's ban |
| `/kick` | Kick a user (they can rejoin) |
| `/mute` | Mute a user (restrict messages) |
| `/unmute` | Unmute a user |
| `/warn` | Issue a warning to a user |
| `/unwarn` | Remove a warning |
| `/warns` | View a user's warning count |
| `/resetwarns` | Reset a user's warnings to zero |
| `/setwarnlimit` | Set max warnings before auto-action |
| `/setwarnmode` | Set action on warn limit (ban/kick/mute) |
| `/purge` | Delete messages from reply point to now |
| `/spurge` | Silent purge (no notification) |
| `/purgefrom` | Delete messages from a specific message ID |
| `/pin` | Pin a message |
| `/unpin` | Unpin a pinned message |
| `/unpinall` | Unpin all pinned messages |
| `/pinned` | Show the current pinned message |
| `/report` | Report a user to admins |
| `/adminlist` | List all current group admins |
| `/slowmode` | Set a message send cooldown |
| `/zombies` | Detect and remove deleted-account members |

### Admin — 11 commands

| Command | Description |
|---|---|
| `/promote` | Promote a user to admin |
| `/demote` | Remove admin from a user |
| `/title` | Set a custom admin title |
| `/setgtitle` | Set the group title |
| `/setgpic` | Set the group photo |
| `/setdesc` | Set the group description |
| `/setsticker` | Set the group sticker pack |
| `/delsticker` | Remove the group sticker pack |
| `/invitelink` | Generate a new invite link |
| `/setlog` | Set a log channel for admin actions |
| `/unsetlog` | Remove the log channel |

### Anti-Spam — 17 commands

| Command | Description |
|---|---|
| `/lock` | Lock a specific message type (links, stickers, etc.) |
| `/unlock` | Unlock a message type |
| `/locks` | View all active locks |
| `/locktypes` | List all lockable message types |
| `/flood` | View current flood settings |
| `/setflood` | Set the flood message threshold |
| `/setfloodmode` | Set action when flood is triggered (ban/kick/mute) |
| `/addblacklist` | Add a phrase to the blacklist |
| `/unblacklist` | Remove a phrase from the blacklist |
| `/blacklist` | View current blacklist |
| `/blacklistmode` | Set action on blacklist match |
| `/captchamode` | Enable/disable CAPTCHA on join |
| `/setcaptcha` | Configure CAPTCHA type |
| `/captchatext` | Set custom CAPTCHA text |
| `/captchakick` | Auto-kick users who fail CAPTCHA |
| `/antiraid` | Toggle anti-raid mode |
| `/setantiraid` | Configure anti-raid threshold and action |

### Greetings — 10 commands

| Command | Description |
|---|---|
| `/welcome` | Preview the current welcome message |
| `/setwelcome` | Set a custom welcome message (supports HTML + variables) |
| `/resetwelcome` | Reset welcome to default |
| `/goodbye` | Preview the current goodbye message |
| `/setgoodbye` | Set a custom goodbye message |
| `/resetgoodbye` | Reset goodbye to default |
| `/cleanwelcome` | Auto-delete old welcome messages |
| `/cleanservice` | Delete service messages (user joined/left) |
| `/welcomemute` | Mute new members until they pass CAPTCHA |
| `/welcomemutehelp` | Show welcome mute instructions to new members |

### Content — 13 commands

| Command | Description |
|---|---|
| `/save` | Save a note with text/media |
| `/get` | Retrieve a saved note |
| `/notes` | List all saved notes |
| `/clear` | Delete a specific note |
| `/clearall` | Delete all notes |
| `/filter` | Create a keyword auto-reply filter |
| `/stop` | Remove a specific filter |
| `/stopall` | Remove all filters |
| `/filters` | List all active filters |
| `/rules` | Show group rules |
| `/setrules` | Set the group rules |
| `/clearrules` | Remove the group rules |
| `/privaterules` | Send rules to users in private chat |

### Federation — 15 commands

| Command | Description |
|---|---|
| `/newfed` | Create a new federation |
| `/delfed` | Delete a federation you own |
| `/joinfed` | Join a federation (applies cross-bans) |
| `/leavefed` | Leave a federation |
| `/chatfed` | Show the federation this chat belongs to |
| `/fedinfo` | Get information about a federation |
| `/fedpromote` | Promote a user to federation admin |
| `/feddemote` | Demote a federation admin |
| `/fedadmins` | List all federation admins |
| `/fban` | Ban a user across all chats in the federation |
| `/unfban` | Remove a federation ban |
| `/fedbanlist` | View all federation-banned users |
| `/myfeds` | List federations you administer |
| `/frename` | Rename a federation |
| `/fednotif` | Toggle federation action notifications |

### Utilities — 11 commands

| Command | Description |
|---|---|
| `/start` | Show bot introduction |
| `/help` | Show all available commands |
| `/info` | Get detailed info about a user |
| `/id` | Show Telegram ID for user/chat |
| `/ping` | Check bot response latency |
| `/stats` | Show bot and chat statistics |
| `/settings` | Open group settings panel |
| `/connect` | Connect a private chat to a group |
| `/disconnect` | Disconnect from a group |
| `/connection` | Show active connection |
| `/allowconnect` | Allow/deny group connections |

### AI — 3 commands

| Command | Description |
|---|---|
| `/chat <message>` | Ask Claude AI (FAQ-constrained) |
| `/ask <question>` | Alias for `/chat` |
| `/support <issue>` | Escalate directly to human moderator |

### Fun — 5 commands

| Command | Description |
|---|---|
| `/hug` | Send a hug to a user |
| `/pat` | Pat a user on the head |
| `/slap` | Slap a user |
| `/roll` | Roll a dice |
| `/runs` | Run away (animated) |

---

## Discord Bot — 55 Commands

Built with **Discord.js** (TypeScript). Full MEE6 feature parity.

### Moderation — 16 commands

| Command | Description |
|---|---|
| `/ban` | Permanently ban a member |
| `/unban` | Remove a ban |
| `/kick` | Kick a member from the server |
| `/mute` | Restrict a member from sending messages |
| `/unmute` | Restore messaging permissions |
| `/timeout` | Apply a Discord native timeout |
| `/warn` | Issue an official warning |
| `/warnings` | View a member's warning history |
| `/clearwarnings` | Clear all warnings for a member |
| `/purge` | Bulk-delete messages in a channel |
| `/clear` | Delete a specific number of messages |
| `/slowmode` | Set channel slow mode |
| `/lockdown` | Lock a channel from everyone |
| `/unlock` | Unlock a channel |
| `/modlogs` | View moderation action log for a member |
| `/reason` | Add a reason to an existing mod action |

### Leveling — 12 commands

| Command | Description |
|---|---|
| `/rank` | Show your current XP rank card |
| `/leaderboard` | Server XP leaderboard |
| `/addxp` | Add XP to a member (admin) |
| `/removexp` | Remove XP from a member (admin) |
| `/setxp` | Set exact XP for a member (admin) |
| `/setlevel` | Set a member's level directly (admin) |
| `/resetlevels` | Reset all server levels (admin) |
| `/xpmultiplier` | Set an XP multiplier for a role |
| `/levelroles` | Configure roles awarded at each level |
| `/levelconfig` | Configure XP gain settings |
| `/levelmessage` | Set the level-up notification message |
| `/levelchannel` | Set the channel for level-up messages |

### Custom Commands — 5 commands

| Command | Description |
|---|---|
| `/addcommand` | Create a custom slash command |
| `/editcommand` | Edit an existing custom command |
| `/removecommand` | Delete a custom command |
| `/listcommands` | Show all custom commands |
| `/customcommand` | Execute a custom command |

### Reaction Roles — 4 commands

| Command | Description |
|---|---|
| `/reactionrole` | Create a reaction role message |
| `/addrr` | Add a reaction-role pair to an existing message |
| `/removerr` | Remove a reaction-role pair |
| `/listrr` | List all reaction roles in the server |

### Engagement — 7 commands

| Command | Description |
|---|---|
| `/poll` | Create a poll with up to 4 options |
| `/giveaway` | Start a giveaway |
| `/endgiveaway` | End a giveaway early |
| `/reroll` | Re-roll a giveaway winner |
| `/reminder` | Set a personal reminder |
| `/timer` | Start a public countdown timer |
| `/birthday` | Register a birthday for milestone messages |

### Social Alerts — 4 commands

| Command | Description |
|---|---|
| `/twitch` | Subscribe to a Twitch streamer's live alerts |
| `/youtube` | Subscribe to a YouTube channel's upload alerts |
| `/twitter` | Subscribe to a Twitter/X account's post alerts |
| `/reddit` | Subscribe to a subreddit's new post alerts |

### Utilities — 7 commands

| Command | Description |
|---|---|
| `/help` | Show all available commands |
| `/ping` | Check bot latency |
| `/serverinfo` | Display server details and statistics |
| `/userinfo` | Display detailed info about a member |
| `/avatar` | Show a member's avatar |
| `/roleinfo` | Display role permissions and details |
| `/membercount` | Show current server member count |

### AI — 1 command

| Command | Description |
|---|---|
| `/chat message:<text>` | Ask Claude AI (FAQ-constrained) |
| `/chat clear:true` | Reset conversation history |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  telegram-bot (Grammy)                   │
│  104 commands across 9 modules                          │
│  /chat  /ask  /support  /aisetup                        │
└───────────────────────┬─────────────────────────────────┘
                        │  imports shared
┌───────────────────────▼─────────────────────────────────┐
│                  shared / AIService                      │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Anthropic   │  │  FAQ Loader  │  │ Injection Guard│  │
│  │  Claude SDK │  │ faq_data.json│  │  8 phrases     │  │
│  └──────┬──────┘  └──────────────┘  └────────────────┘  │
│         │ (on fail)                                      │
│  ┌──────▼──────┐  ┌──────────────┐  ┌────────────────┐  │
│  │   Ollama    │  │   Escalation │  │  Redis Memory  │  │
│  │  Fallback   │  │   (ESCALATE) │  │  Rate Limits   │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │  imports shared
┌───────────────────────▼─────────────────────────────────┐
│                  discord-bot (Discord.js)                │
│  55 commands across 8 modules                           │
│  /chat (slash command)                                  │
└─────────────────────────────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         PostgreSQL            Redis
      (moderation data,    (AI memory,
       levels, warns)       rate limits)
```

**Data Flow:**
1. User sends a message → bot command handler fires
2. `aiService.chat(context, message)` is called
3. Input is sanitized (injection check + truncate)
4. Rate limit is checked against Redis
5. Conversation history is loaded from Redis
6. FAQ system prompt is injected
7. Anthropic Claude processes the full context
8. If `ESCALATE` → human moderator is notified
9. Response + updated history saved back to Redis
10. Reply sent to user

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Redis** 6+
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com/)
- **Telegram Bot Token** — from [@BotFather](https://t.me/BotFather)
- **Discord Bot Token** — from [Discord Developer Portal](https://discord.com/developers)

### Setup

```bash
# 1. Clone
git clone https://github.com/zakky8/super-bot.git
cd super-bot

# 2. Install all dependencies
cd shared && npm install && npm run build && cd ..
cd telegram-bot && npm install && cd ..
cd discord-bot && npm install && cd ..

# 3. Configure environment
cp telegram-bot/.env.example telegram-bot/.env
cp discord-bot/.env.example discord-bot/.env
# Edit both .env files with your credentials

# 4. Build
cd telegram-bot && npm run build && cd ..
cd discord-bot && npm run build && cd ..

# 5. Deploy Discord slash commands (once)
cd discord-bot && npm run deploy && cd ..

# 6. Run (development)
cd telegram-bot && npm run dev &
cd discord-bot && npm run dev &
```

### AI Setup (3 steps)

```bash
# Step 1 — Add to telegram-bot/.env and discord-bot/.env:
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
BOT_NAME=SupportBot

# Step 2 — (Optional) Set moderator targets for escalation:
HUMAN_MODERATOR_CHAT_ID=123456789       # Telegram
HUMAN_MODERATOR_CHANNEL=987654321       # Discord channel ID

# Step 3 — Edit faq_data.json with your community's Q&A pairs
```

---

## Environment Variables

### Telegram Bot (`telegram-bot/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Telegram bot token from @BotFather |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API key |
| `ANTHROPIC_MODEL` | ❌ | `claude-sonnet-4-6` | Claude model to use |
| `BOT_NAME` | ❌ | `SupportBot` | Name shown in AI responses |
| `REDIS_URL` | ❌ | in-memory | Redis connection URL |
| `REDIS_PASSWORD` | ❌ | — | Redis auth password |
| `ADMIN_IDS` | ❌ | — | Comma-separated Telegram user IDs with bot admin access |
| `HUMAN_MODERATOR_CHAT_ID` | ❌ | — | Telegram chat ID for escalation alerts |
| `OLLAMA_HOST` | ❌ | `http://localhost:11434` | Ollama host for AI fallback |
| `LOG_LEVEL` | ❌ | `info` | Winston log level |

### Discord Bot (`discord-bot/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Discord bot token |
| `CLIENT_ID` | ✅ | — | Discord application client ID |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API key |
| `ANTHROPIC_MODEL` | ❌ | `claude-sonnet-4-6` | Claude model to use |
| `BOT_NAME` | ❌ | `SupportBot` | Name shown in AI responses |
| `REDIS_URL` | ❌ | in-memory | Redis connection URL |
| `REDIS_PASSWORD` | ❌ | — | Redis auth password |
| `HUMAN_MODERATOR_CHANNEL` | ❌ | — | Discord channel ID for escalation alerts |
| `OLLAMA_HOST` | ❌ | `http://localhost:11434` | Ollama host for AI fallback |
| `LOG_LEVEL` | ❌ | `info` | Winston log level |

### Supported Claude Models

| Model | Speed | Intelligence | Best For |
|---|---|---|---|
| `claude-sonnet-4-6` | Fast | High | **Recommended — default** |
| `claude-opus-4-5` | Slower | Highest | Complex reasoning |
| `claude-haiku-4-5` | Fastest | Good | High-volume simple queries |
| `claude-3-5-sonnet-20241022` | Fast | High | Stable production alias |
| `claude-3-haiku-20240307` | Fastest | Good | Ultra-low latency |

---

## Docker Deployment

The `docker-compose.yml` starts the full stack: both bots, PostgreSQL 14, and Redis 7.

```bash
# 1. Copy and fill in the root .env
cp .env.example .env

# Required variables in root .env:
# TELEGRAM_BOT_TOKEN=
# DISCORD_BOT_TOKEN=
# DISCORD_CLIENT_ID=
# POSTGRES_PASSWORD=
# ANTHROPIC_API_KEY=
# REDIS_PASSWORD=          (optional)
# TELEGRAM_ADMIN_IDS=      (optional)
# LOG_LEVEL=info           (optional)

# 2. Start
docker-compose up -d

# 3. View logs
docker-compose logs -f telegram-bot
docker-compose logs -f discord-bot

# 4. Stop
docker-compose down
```

**Services started:**

| Service | Port | Description |
|---|---|---|
| `telegram-bot` | — | Telegram bot process |
| `discord-bot` | — | Discord bot process |
| `postgres` | 5432 | PostgreSQL 14 (Alpine) |
| `redis` | 6379 | Redis 7 (Alpine) |

Both bots wait for healthy Postgres and Redis before starting (via `depends_on` health checks).

---

## PM2 Production Deployment

Use PM2 to run both bots as managed processes with auto-restart and log rotation:

```bash
# 1. Build both bots
cd shared && npm run build && cd ..
cd telegram-bot && npm run build && cd ..
cd discord-bot && npm run build && cd ..

# 2. Start with PM2
pm2 start ecosystem.config.js

# 3. Monitor
pm2 status
pm2 logs telegram-bot
pm2 logs discord-bot

# 4. Save process list (survives reboots)
pm2 save
pm2 startup
```

**PM2 Configuration (`ecosystem.config.js`):**

| Setting | Value |
|---|---|
| Instances | 1 per bot |
| Auto-restart | Yes |
| Max memory | 500 MB (triggers restart) |
| Error log | `./[bot]/logs/error.log` |
| Output log | `./[bot]/logs/out.log` |
| Log date format | `YYYY-MM-DD HH:mm:ss Z` |

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/check.yml`) runs on every push and pull request:

```
Code Quality
└── TypeScript type-check (shared → telegram → discord)
    ├── actions/checkout@v4
    ├── actions/setup-node@v4 (Node 18)
    ├── Cache shared/node_modules
    ├── Install + build shared       ← tsc composite build
    ├── Run shared tests             ← 7 AIService unit tests
    ├── Cache telegram-bot/node_modules
    ├── Install telegram-bot deps
    ├── Type-check telegram-bot      ← tsc --noEmit
    ├── Cache discord-bot/node_modules
    ├── Install discord-bot deps
    └── Type-check discord-bot       ← tsc --noEmit
```

**Unit tests** (`shared/tests/AIService.test.ts`) — 7 tests covering:
1. Creates empty context for a new user
2. Saves and retrieves conversation context
3. Clears conversation context
4. Enforces rate limit (allows N, blocks N+1)
5. Blocks prompt injection phrases
6. Passes safe input unchanged
7. Truncates input over 1 000 characters

Build order is critical — `shared` must be compiled first because both bots reference it via TypeScript project references (`tsconfig.json` → `"references": [{"path": "../shared"}]`).

---

## Related Repositories

| Repo | Description |
|---|---|
| [zakky8/Auto-Moderation](https://github.com/zakky8/Auto-Moderation) | Standalone AI scam detection moderation bot |
| [zakky8/Support-Ticket-Classifier](https://github.com/zakky8/Support-Ticket-Classifier) | ML-powered ticket routing dashboard |
| [zakky8/Crypto-Sentiment-Tracker](https://github.com/zakky8/Crypto-Sentiment-Tracker) | Real-time Reddit + price sentiment tracker |

---

## License

MIT
