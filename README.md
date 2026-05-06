# Super Bot v3.0 — Telegram Community Bot

A production-grade Telegram bot system built with TypeScript, featuring advanced moderation, anti-spam, and Anthropic Claude AI integration with RAG (Retrieval-Augmented Generation).

## Features

- **AI Integration**: Powered by Anthropic Claude (via SDK or AWS Bedrock).
- **RAG System**: Retrieval-Augmented Generation for project-specific knowledge.
- **Advanced Moderation**: Ban, mute, kick, warn, and purge commands.
- **Anti-Spam**: Captcha, flood detection, anti-raid, and blacklist.
- **Federation System**: Share bans across multiple groups.
- **Notes & Filters**: Save responses and trigger replies on keywords.
- **Persistence**: PostgreSQL for data and Redis for session/rate limiting.

## Project Structure

- `telegram-bot/`: Main bot implementation using Grammy.
- `shared/`: Core library for AI, database, and utilities.
- `scripts/`: Database initialization and utility scripts.

## Getting Started

1. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your tokens and credentials
   ```

2. **Installation**:
   ```bash
   npm run install:all
   ```

3. **Building**:
   ```bash
   npm run build
   ```

4. **Running**:
   ```bash
   npm run start:telegram
   ```

## Development

- `npm run dev:telegram`: Run the bot in development mode with hot-reload.
- `npm run typecheck`: Run TypeScript type checking.
- `npm run test`: Run the test suite.

## License

MIT
