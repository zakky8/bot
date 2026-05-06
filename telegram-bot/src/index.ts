import 'dotenv/config';
import { Bot, session } from 'grammy';
import { I18n } from '@grammyjs/i18n';
import { RedisAdapter } from '@grammyjs/storage-redis';
import Redis from 'ioredis';
import { run } from '@grammyjs/runner';
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { autoRetry } from '@grammyjs/auto-retry';
import { webhookCallback } from 'grammy';
import { createServer } from 'http';
import { createLogger } from './core/logger';
import { connectDatabase } from './core/database';
import { connectRedis } from './core/redis';
import { authMiddleware } from './middlewares/auth';
import { userTrackerMiddleware } from './middlewares/userTracker';
import { rateLimitMiddleware } from './middlewares/rateLimit';
import { loggingMiddleware } from './middlewares/logging';
import { errorHandler } from './middlewares/errorHandler';
import { locksMiddleware } from './middlewares/locks';
import { floodMiddleware } from './middlewares/flood';
import { contentMiddleware } from './middlewares/content';
import { BotContext, SessionData } from './types';
import { isBotAdmin } from './utils/permissions';

const i18n = new I18n<BotContext>({
  defaultLocale: 'en',
  directory: join(__dirname, 'locales'),
});

const logger = createLogger('Main');

// Create bot
const bot = new Bot<BotContext>(process.env.BOT_TOKEN!);

// Auto-Retry API requests globally
bot.api.config.use(autoRetry());

// Redis connection for Session Storage
export const sessionRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
sessionRedis.on('error', (err) => logger.error('Session Redis Error:', err));

// Use session with Redis storage
bot.use(session({
  initial: (): SessionData => ({
    language: 'en',
    userData: {},
    captcha: { enabled: false, mode: 'button' },
    locks: {},
    lockMode: 'off',
    approvals: [],
    notes: {},
    warnings: {},
    filters: {},
    blacklist: [],
    blacklistMode: 'delete',
    antiraid: { enabled: false, recentJoins: [] },
    flood: { limit: 0, interval: 5, action: 'mute' },
    federations: {}
  }),
  storage: new RedisAdapter({ instance: sessionRedis }),
  getSessionKey: async (ctx) => {
    // If in a private chat, check for an active connection to a group
    if (ctx.chat?.type === 'private' && ctx.from) {
      try {
        const connectedChatId = await sessionRedis.get(`user_connection:${ctx.from.id}`);
        if (connectedChatId) {
          return connectedChatId; // Seamlessly route session to the group!
        }
      } catch (err) {
        logger.error('Error fetching user connection from Redis:', err);
      }
    }
    // Default: Store settings per chat
    return ctx.chat?.id.toString();
  },
}));

// Use middlewares
bot.use(i18n);
bot.use(loggingMiddleware);
bot.use(userTrackerMiddleware);

// Restriction: Only Bot Admins/Owners can use the bot in DMs
bot.on('message', async (ctx, next) => {
  if (ctx.chat?.type === 'private' && !isBotAdmin(ctx)) {
    return; // Silent ignore for non-admins in DM
  }
  return next();
});

bot.use(authMiddleware);
bot.use(locksMiddleware);
bot.use(floodMiddleware);
bot.use(contentMiddleware);
bot.use(rateLimitMiddleware);

// Load commands
async function loadCommands() {
  const commandsPath = join(__dirname, 'commands');
  if (!existsSync(commandsPath)) {
    logger.warn('Commands directory not found');
    return;
  }
  const commandFolders = readdirSync(commandsPath);

  for (const folder of commandFolders) {
    const folderPath = join(commandsPath, folder);
    // Skip files, only process directories
    const stat = statSync(folderPath);
    if (!stat.isDirectory()) continue;

    const commandFiles = readdirSync(folderPath).filter(
      (file) => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')
    );

    for (const file of commandFiles) {
      const filePath = join(folderPath, file);
      try {
        const command = require(filePath);
        if (command.default && typeof command.default === 'function') {
          command.default(bot);
          logger.info(`Loaded command: ${folder}/${file}`);
        }
      } catch (error) {
        logger.error(`Error loading command ${folder}/${file}:`, error);
      }
    }
  }
}

// Load handlers
async function loadHandlers() {
  const handlersPath = join(__dirname, 'handlers');
  if (!existsSync(handlersPath)) {
    logger.warn('Handlers directory not found');
    return;
  }
  const handlerFiles = readdirSync(handlersPath).filter(
    (file) => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')
  );

  for (const file of handlerFiles) {
    const filePath = join(handlersPath, file);
    try {
      const handler = require(filePath);
      if (handler.default && typeof handler.default === 'function') {
        handler.default(bot);
        logger.info(`Loaded handler: ${file}`);
      }
    } catch (error) {
      logger.error(`Error loading handler ${file}:`, error);
    }
  }
}

// Initialize bot
async function init() {
  try {
    logger.info('Initializing Telegram bot...');

    // Connect to services (graceful — won't crash without them)
    await connectDatabase();
    await connectRedis();

    // Load bot components
    await loadCommands();
    await loadHandlers();

    // Use error handler
    bot.catch(errorHandler);

    // Start bot
    if (process.env.WEBHOOK_URL) {
      const server = createServer(webhookCallback(bot, 'http'));
      const PORT = process.env.PORT || 3000;
      server.listen(PORT, async () => {
        await bot.api.setWebhook(process.env.WEBHOOK_URL!, {
          allowed_updates: ['message', 'edited_message', 'callback_query', 'chat_member']
        });
        logger.info(`Webhook server listening on port ${PORT}`);
      });

      // Handle graceful shutdown
      const stopServer = () => {
        logger.info('Stopping webhook server...');
        server.close();
      };
      process.once('SIGINT', stopServer);
      process.once('SIGTERM', stopServer);
    } else {
      // Wait to clear any lingering webhook before starting runner
      await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => { });

      const runner = run(bot, {
        runner: {
          fetch: {
            allowed_updates: ['message', 'edited_message', 'callback_query', 'chat_member']
          }
        }
      });

      // Handle graceful shutdown
      const stopRunner = () => {
        logger.info('Stopping polling runner...');
        runner.isRunning() && runner.stop();
      };
      process.once('SIGINT', stopRunner);
      process.once('SIGTERM', stopRunner);
    }

    // Clear global and group scopes first to ensure the menu disappears from groups
    await bot.api.deleteMyCommands({ scope: { type: 'default' } }).catch(() => { });
    await bot.api.deleteMyCommands({ scope: { type: 'all_group_chats' } }).catch(() => { });

    // Register commands ONLY for Private Chats (DMs)
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help menu with all features' },
      { command: 'chat', description: 'Ask the AI assistant a question' },
      { command: 'ask', description: 'Ask a question (alias for /chat)' },
      { command: 'support', description: 'Escalate to a human moderator' },
      { command: 'rules', description: 'View group rules' },
      { command: 'notes', description: 'List saved notes' },
      { command: 'ping', description: 'Check bot latency' },
      { command: 'id', description: 'Show your Telegram ID' },
      { command: 'info', description: 'Get info about a user' },
      { command: 'stats', description: 'Show bot statistics' },
      { command: 'settings', description: 'View group settings' },
      { command: 'report', description: 'Report a user to admins' },
      { command: 'adminlist', description: 'List group admins' },
      { command: 'warns', description: 'Check your warnings' },
      { command: 'filters', description: 'List active filters' },
      { command: 'connect', description: 'Connect to a group for remote configuration' },
      { command: 'disconnect', description: 'Disconnect from the remote group' },
      { command: 'connection', description: 'Check your current connection status' },
      { command: 'addbotadmin', description: 'Promote a user to Global Bot Admin (Owner Only)' },
      { command: 'delbotadmin', description: 'Demote a Global Bot Admin (Owner Only)' },
      { command: 'botadmins', description: 'List all Global Bot Admins (Owner Only)' },
    ], { scope: { type: 'all_private_chats' } });

    logger.info('Command menu registered with Telegram (Private Chats Only)');

    logger.info('Telegram bot started successfully');
  } catch (error) {
    logger.error('Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Start bot
init();

export { bot };
