# Telegram Management Bot

Advanced Telegram group management bot with comprehensive moderation, anti-spam, federation support, and AI-powered support. Built with **grammY** and TypeScript.

## Features

- **Moderation** (22 commands) — Ban, kick, mute, warn, purge, pin, slowmode, admin list, zombie detection
- **Admin** (11 commands) — Promote, demote, set title, group settings, invite links
- **Anti-Spam** (17 commands) — Lock/unlock, flood control, blacklist, CAPTCHA, anti-raid
- **Greetings** (10 commands) — Welcome/goodbye messages, clean service messages, welcome mute
- **Content** (13 commands) — Notes, filters, rules system
- **Federation** (15 commands) — Cross-group ban federation system
- **Utility** (11 commands) — Start, help, info, IDs, ping, stats, settings, connections
- **Fun** (5 commands) — Roll dice, slap, pat, hug, random run messages
- **AI Support** (3 commands) — FAQ-constrained AI chat with deterministic link lookup and human escalation

**Total: 105 commands**

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 18+ |
| Language | TypeScript 5.3 |
| Framework | grammY |
| Sessions | Redis (ioredis) |
| Logging | Winston (rotating log files) |
| AI (primary) | AWS Bedrock — Claude via Bedrock Runtime |
| AI (direct) | Anthropic Claude API (claude-sonnet-4-6) |
| AI (fallback) | Ollama (local, llama3.2:3b) |
| RAG | VectorStoreService — cosine + keyword hybrid search |
| Process Manager | PM2 |

## Quick Start

### Prerequisites

- Node.js 18+
- Redis 7+
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- Anthropic API key **or** AWS credentials (Bedrock)

### Setup

1. **Install dependencies for both packages**
   ```bash
   cd shared && npm install
   cd ../telegram-bot && npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Start in development mode**
   ```bash
   npm run dev
   ```

4. **Build for production**
   ```bash
   # From the repo root — shared must be built first
   npm run build:shared
   npm run build:telegram
   npm start            # inside telegram-bot/
   ```

### Production deploy (PM2)

```bash
# Full rebuild + restart (run from repo root)
npm run build:shared && npm run build:telegram && pm2 restart tenet-bot

# First-time PM2 setup
pm2 start ecosystem.config.js
pm2 save
```

> **Note:** The running PM2 process is named `tenet-bot`. The `ecosystem.config.js` `name` field is `telegram-bot` but the live process ID/name differs — always restart by the actual process name shown in `pm2 list`.

## Project Structure

```
bot/
├── shared/                     # Shared package (built first)
│   └── src/services/ai/
│       ├── AIService.ts        # AI provider abstraction (Bedrock / Anthropic / Ollama)
│       └── VectorStoreService.ts  # RAG vector store with hybrid scoring
├── telegram-bot/
│   └── src/
│       ├── index.ts            # Main entry point + graceful shutdown
│       ├── commands/           # 105 bot commands
│       │   ├── moderation/     # 22 moderation commands
│       │   ├── admin/          # 11 admin commands
│       │   ├── antispam/       # 17 anti-spam commands
│       │   ├── greetings/      # 10 greeting commands
│       │   ├── content/        # 13 content commands
│       │   ├── federation/     # 15 federation commands
│       │   ├── utility/        # 11 utility commands
│       │   ├── fun/            # 5 fun commands
│       │   └── ai/
│       │       └── chat.ts     # AI commands: /ask /ai /support
│       ├── middlewares/        # Auth, flood, locks, group whitelist, error handler
│       ├── core/               # AI service init, Redis, Logger
│       ├── types/              # TypeScript type definitions
│       └── utils/              # Permissions (cached), group whitelist, helpers
├── ecosystem.config.js         # PM2 config
└── docs/commands/README.md     # Full command reference
```

## Commands Reference

### AI Support (3)
`/ask <question>` · `/ai <question>` · `/support <issue>`

- `/ask` and `/ai` are identical — both trigger the AI chat handler
- `/support` bypasses AI and routes directly to a human moderator
- AI responses are FAQ-constrained via RAG (VectorStore knowledge base)
- Simple link requests (`/ask gitbook link`) are resolved deterministically — no AI hallucination
- When the AI cannot answer, it escalates and notifies `HUMAN_MODERATOR_CHAT_ID`

### Moderation (22)
`/ban` · `/unban` · `/kick` · `/mute` · `/unmute` · `/warn` · `/unwarn` · `/warns` · `/resetwarns` · `/setwarnlimit` · `/setwarnmode` · `/purge` · `/spurge` · `/purgefrom` · `/slowmode` · `/pin` · `/unpin` · `/unpinall` · `/pinned` · `/adminlist` · `/zombies` · `/report`

### Admin (11)
`/promote` · `/demote` · `/title` · `/setlog` · `/unsetlog` · `/setdesc` · `/setgtitle` · `/setgpic` · `/setsticker` · `/delsticker` · `/invitelink`

### Anti-Spam (17)
`/lock` · `/unlock` · `/locks` · `/locktypes` · `/setflood` · `/flood` · `/setfloodmode` · `/blacklist` · `/addblacklist` · `/unblacklist` · `/blacklistmode` · `/setcaptcha` · `/captchamode` · `/captchatext` · `/captchakick` · `/antiraid` · `/setantiraid`

### Greetings (10)
`/welcome` · `/setwelcome` · `/resetwelcome` · `/goodbye` · `/setgoodbye` · `/resetgoodbye` · `/cleanwelcome` · `/cleanservice` · `/welcomemute` · `/welcomemutehelp`

### Content (13)
`/save` · `/get` · `/clear` · `/clearall` · `/notes` · `/filter` · `/filters` · `/stop` · `/stopall` · `/rules` · `/setrules` · `/clearrules` · `/privaterules`

### Federation (15)
`/newfed` · `/delfed` · `/fedinfo` · `/joinfed` · `/leavefed` · `/fban` · `/unfban` · `/fednotif` · `/chatfed` · `/myfeds` · `/fedadmins` · `/fedpromote` · `/feddemote` · `/frename` · `/fedbanlist`

### Utility (11)
`/start` · `/help` · `/info` · `/id` · `/ping` · `/stats` · `/settings` · `/connect` · `/disconnect` · `/connection` · `/allowconnect`

### Fun (5)
`/roll` · `/slap` · `/pat` · `/hug` · `/runs`

## AI System

The AI layer uses a three-tier provider chain:

1. **AWS Bedrock** — primary inference (Claude via Bedrock Runtime)
2. **Anthropic API** — direct Claude access (fallback / configurable)
3. **Ollama** — local model fallback (llama3.2:3b, offline-capable)

### Deterministic link lookup
Link requests (`give me the discord link`, `gitbook?`, `twitter link`) are intercepted **before** hitting the AI. A static lookup table maps keywords → verified URLs so the correct link is always returned regardless of what the model might produce.

### RAG knowledge base
The AI queries a VectorStore (cosine + keyword hybrid scoring) backed by a `faq_data.json` knowledge file before generating answers. Answers are synthesized — not pasted verbatim from the FAQ.

### Human escalation
When the AI cannot find a relevant answer it replies with an escalation message and sends a notification to `HUMAN_MODERATOR_CHAT_ID`. `/support` triggers this path directly.

### Output guard
The final response is filtered to catch explicit AI identity confessions (`I am Claude`, `powered by Anthropic`) and replace them with the configured bot persona (`BOT_NAME`).

## Middleware Pipeline

1. **Group Whitelist** — Ignore messages from non-whitelisted groups (cached in memory)
2. **Authentication** — Admin/owner permission checks (in-memory cached admin list)
3. **Flood Control** — Rate limiting with stale-entry cleanup to prevent memory leak
4. **Content Locks** — Enforce per-type locks with configurable actions (warn/mute/kick/ban)
5. **Error Handler** — Catches unhandled errors, replies to user, logs to file

## Scripts

```bash
npm run dev          # Start with hot-reload (tsx watch)
npm run build        # Compile TypeScript + copy locales
npm start            # Run compiled JS (dist/index.js)
npm test             # Run tests with coverage
npm run lint         # Lint source files
npm run format       # Format with Prettier
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `REDIS_URL` | Yes | Redis connection string |
| `REDIS_PASSWORD` | No | Redis password if auth enabled |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key (* or use AWS) |
| `ANTHROPIC_MODEL` | No | Model override (default: `claude-sonnet-4-6`) |
| `AWS_ACCESS_KEY_ID` | Yes* | AWS credentials for Bedrock (* or use Anthropic) |
| `AWS_SECRET_ACCESS_KEY` | Yes* | AWS secret key |
| `AWS_REGION` | No | AWS region (default: `us-east-1`) |
| `BOT_NAME` | No | Name shown in AI persona (default: `your Astarter assistant`) |
| `HUMAN_MODERATOR_CHAT_ID` | No | Telegram chat ID for escalation/error alerts |
| `OWNER_ID` | No | Bot owner Telegram user ID |
| `ADMIN_IDS` | No | Comma-separated admin Telegram user IDs |
| `LOG_LEVEL` | No | Winston log level (default: `info`) |
| `OLLAMA_HOST` | No | Ollama base URL for local fallback |

See `.env.example` for a full template.

## License

MIT — see [LICENSE](../LICENSE)
