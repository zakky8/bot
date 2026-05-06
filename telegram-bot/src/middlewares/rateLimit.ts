import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { createLogger } from '../core/logger';

import Redis from 'ioredis';

const logger = createLogger('RateLimit');

// Connect to Redis for horizontal scalability
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => logger.error('RateLimit Redis Error:', err));

const RATE_LIMIT = 30; // messages
const WINDOW_SECS = 60; // 1 minute

export const rateLimitMiddleware = async (ctx: BotContext, next: NextFunction) => {
  if (!ctx.from) return await next();

  const userId = ctx.from.id;
  const key = `ratelimit:${userId}`;

  try {
    const count = await redis.incr(key);
    
    // If it's the first message in the window, set the expiration
    if (count === 1) {
      await redis.expire(key, WINDOW_SECS);
    }

    if (count > RATE_LIMIT) {
      logger.warn(`Rate limited user ${userId}`);
      return ctx.reply('⚠️ You are sending messages too fast. Please slow down.');
    }
  } catch (err) {
    logger.error('Redis rate limiter failed, bypassing:', err);
  }

  await next();
};
