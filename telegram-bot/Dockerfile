# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

COPY . .
RUN npm run install:all
RUN npm run build

# Copy non-TS runtime assets into dist
RUN cp -r /app/telegram-bot/src/locales /app/telegram-bot/dist/locales

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:18-alpine

WORKDIR /app

# Copy workspace manifests
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/telegram-bot/package.json ./telegram-bot/

# Install ALL workspace production deps in one shot (shared + telegram-bot)
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/telegram-bot/dist ./telegram-bot/dist

# Runtime assets
COPY --from=builder /app/telegram-bot/faq_data.json ./telegram-bot/faq_data.json
COPY --from=builder /app/telegram-bot/bot_admins.json ./telegram-bot/bot_admins.json
COPY --from=builder /app/telegram-bot/storage ./telegram-bot/storage

RUN mkdir -p /app/telegram-bot/logs /app/telegram-bot/storage/vectors

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app/telegram-bot/logs /app/telegram-bot/storage
USER nodejs

WORKDIR /app/telegram-bot
CMD ["node", "dist/index.js"]
