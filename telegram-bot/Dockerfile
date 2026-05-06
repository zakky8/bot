# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Install all dependencies across all packages
COPY . .
RUN npm run install:all

# Build the project
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:18-alpine

WORKDIR /app

# Copy built files and dependency definitions
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/telegram-bot/package.json ./telegram-bot/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/telegram-bot/dist ./telegram-bot/dist

# Install production dependencies for the bot
RUN cd telegram-bot && npm install --omit=dev

# Create logs directory
RUN mkdir -p /app/telegram-bot/logs

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

WORKDIR /app/telegram-bot
CMD ["node", "dist/index.js"]
