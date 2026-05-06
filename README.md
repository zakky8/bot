# Astarter Community Bot

A production-grade Telegram community management bot built with **TypeScript** and **Grammy**, featuring advanced moderation, anti-spam tools, and an **AWS Bedrock RAG-powered AI assistant** with a natural persona.

---

## Stack

| Layer | Technology |
|---|---|
| Bot framework | [Grammy](https://grammy.dev) v1.21+ |
| Language | TypeScript 5 |
| AI (LLM) | AWS Bedrock — `openai.gpt-oss-20b-1:0` (eu-north-1) |
| AI (Embeddings) | AWS Bedrock — `amazon.titan-embed-text-v2:0` |
| Vector store | Local JSON flat-file with cosine similarity |
| Session / rate-limit | Redis (ioredis) |
| Database | PostgreSQL (optional, graceful fallback) |
| Runtime | Node.js 20+ |

---

## Features

### 🤖 AI Assistant (RAG-powered)
- Natural persona via an ElevenLabs-style six-block system prompt
- Knowledge base built from your own documents, URLs, and text snippets
- Semantic search over indexed content using 1024-dim Titan v2 embeddings
- Auto-escalation to human moderators when a question is out of scope
- 4-layer identity masking — the bot never breaks character
- Telegram-safe HTML output (converts `<ul>/<li>/<h1>` etc. to plain bullets and `<b>` tags)

### 🛡️ Moderation
- Ban / unban, kick, mute / unmute with optional duration
- Warn system with configurable warn limit and action (ban/kick/mute)
- Purge, spurge, and purge-from-message commands
- Pin / unpin / unpin-all

### 🚫 Anti-Spam
- Configurable flood control
- CAPTCHA for new members (text or button)
- Anti-raid mode
- Word blacklist with configurable punishment mode
- Message type locks (links, stickers, media, etc.)

### 🗂️ Notes & Filters
- Save notes that any member can retrieve with `#note` or `/get`
- Keyword filters that auto-reply with saved content

### 🤝 Federation System
- Create federations and share bans across multiple groups

### 👋 Greetings
- Customisable welcome and goodbye messages with variable substitution
- Welcome-mute until new members pass a check
- Clean-service and clean-welcome toggles

---

## Project Layout

```
bot/
├── telegram-bot/         # Grammy bot application
│   ├── src/
│   │   ├── commands/
│   │   │   ├── ai/       # /ask, /adddoc, /docstats, /testsearch …
│   │   │   ├── admin/
│   │   │   ├── antispam/
│   │   │   ├── moderation/
│   │   │   ├── content/
│   │   │   ├── greetings/
│   │   │   ├── federation/
│   │   │   ├── fun/
│   │   │   └── utility/
│   │   ├── handlers/     # Message & new-member handlers
│   │   ├── middlewares/  # Auth, rate-limit, session
│   │   ├── core/         # Redis, DB, AI service wiring
│   │   ├── utils/        # Permissions, helpers
│   │   └── index.ts      # Entry point
│   ├── faq_data.json     # Seed FAQ for RAG knowledge base
│   └── storage/
│       └── vectors/
│           └── vector_db.json   # Persisted embeddings
│
├── shared/               # Shared library (AI + DB services)
│   └── src/services/ai/
│       ├── AIService.ts          # LLM, RAG, escalation logic
│       └── VectorStoreService.ts # Embedding + cosine search
│
└── scripts/              # DB init and utility scripts
```

---

## Environment Variables

Create `telegram-bot/.env`:

```env
# Telegram
BOT_TOKEN=your_bot_token_here
BOT_NAME=YourBotName

# Owner & moderation
OWNER_ID=your_telegram_user_id
HUMAN_MODERATOR_CHAT_ID=mod_chat_or_user_id

# Redis
REDIS_URL=redis://localhost:6379

# AWS Bedrock (LLM + embeddings)
AWS_ACCESS_KEY=your_aws_access_key
AWS_SECRET_KEY=your_aws_secret_key
AWS_REGION=eu-north-1

# AI model
AI_MODEL=openai.gpt-oss-20b-1:0
```

---

## Setup & Running

### Prerequisites
- Node.js 20+
- Redis running locally or via URL
- AWS account with Bedrock enabled in `eu-north-1`

### Install

```bash
npm run install:all
```

### Build

```bash
# Build shared library first, then the bot
cd shared && npx tsc
cd ../telegram-bot && npx tsc
```

### Run

```bash
cd telegram-bot
node dist/index.js
```

### Development (hot-reload)

```bash
cd telegram-bot
npm run dev
```

---

## AI Commands

> All AI commands are restricted to **bot admins and the owner** by default.

| Command | Description |
|---|---|
| `/ask <message>` | Chat with the AI assistant |
| `/ask clear` | Clear your conversation history |
| `/adddoc <text\|URL>` | Index text or a webpage into the knowledge base |
| `/adddoc` *(reply to file)* | Index a PDF, DOCX, TXT, MD, CSV, or JSON file |
| `/docstats` | Show knowledge base status and chunk count |
| `/testsearch <query>` | Check if the knowledge base has relevant data |
| `/removedoc <source>` | Remove all chunks from a specific source |
| `/clearall` | Wipe the entire knowledge base |
| `/updatedocs` | Reload and re-index the FAQ file |
| `/aion` / `/aioff` | Enable or disable AI responses in a group |
| `/support <issue>` | Send a support request to human moderators (available to all members) |

---

## Moderation Commands

| Command | Description |
|---|---|
| `/ban` | Ban a user |
| `/unban` | Unban a user |
| `/kick` | Kick a user |
| `/mute [time]` | Mute a user |
| `/unmute` | Unmute a user |
| `/warn` | Warn a user |
| `/warns` | View a user's warnings |
| `/unwarn` | Remove a warning |
| `/resetwarns` | Reset all warnings for a user |
| `/setwarnlimit` | Set warning limit before action |
| `/setwarnmode` | Set action on warn limit (ban/kick/mute) |
| `/purge` | Delete messages from reply up to latest |
| `/purgefrom` | Delete from a specific message ID |
| `/spurge` | Silent purge (no confirmation) |
| `/pin` / `/unpin` / `/unpinall` | Pin management |
| `/slowmode [seconds]` | Set slowmode |
| `/adminlist` | List group admins |
| `/report` | Report a message to admins |

---

## Anti-Spam Commands

| Command | Description |
|---|---|
| `/setflood <count>` | Set flood message limit |
| `/flood` | Show current flood settings |
| `/setfloodmode` | Set flood action (ban/kick/mute) |
| `/setcaptcha` | Configure captcha for new members |
| `/captchamode` | Toggle captcha on/off |
| `/setantiraid` | Configure anti-raid settings |
| `/antiraid` | Toggle anti-raid on/off |
| `/addblacklist <word>` | Add a word to the blacklist |
| `/unblacklist <word>` | Remove a word from the blacklist |
| `/blacklist` | View blacklisted words |
| `/blacklistmode` | Set blacklist punishment mode |
| `/locks` | View active locks |
| `/lockmenu` | Interactive lock menu |

---

## Notes & Filters

| Command | Description |
|---|---|
| `/save <name> <content>` | Save a note |
| `/get <name>` | Retrieve a note |
| `/notes` | List all notes |
| `/clear <name>` | Delete a note |
| `/filter <keyword> <reply>` | Add a keyword filter |
| `/filters` | List all filters |
| `/stop <keyword>` | Remove a filter |
| `/stopall` | Remove all filters |
| `/setrules <text>` | Set group rules |
| `/rules` | Show group rules |

---

## Greeter Commands

| Command | Description |
|---|---|
| `/setwelcome <text>` | Set welcome message |
| `/resetwelcome` | Reset to default welcome |
| `/welcome` | Show current welcome settings |
| `/setgoodbye <text>` | Set goodbye message |
| `/resetgoodbye` | Reset goodbye |
| `/cleanservice on/off` | Auto-delete join/leave service messages |
| `/cleanwelcome on/off` | Auto-delete previous welcome message |

---

## Permissions Model

- **Owner** (`OWNER_ID`) — full access to all commands including `/clearall`, `/adddoc`, `/aion`/`/aioff`
- **Bot Admins** — access to moderation, AI `/ask`, and most admin commands
- **Group Members** — `/support`, `/rules`, `/notes`, `/report` only
- **DMs** — blocked for non-admins ("I only operate in the project group")

---

## License

MIT
