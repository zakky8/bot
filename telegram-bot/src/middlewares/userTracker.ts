import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { sessionRedis } from '../index';
import { createLogger } from '../core/logger';

const logger = createLogger('UserTracker');

/**
 * Middleware to track users and cache their username -> user_id mapping in Redis.
 * This allows moderation commands to resolve usernames even if they aren't in the current chat's context.
 */
export const userTrackerMiddleware = async (ctx: BotContext, next: NextFunction) => {
    if (ctx.from) {
        const userId = ctx.from.id;
        
        // Cache mapping if username exists
        if (ctx.from.username) {
            const username = ctx.from.username.toLowerCase();
            // Cache for 30 days
            await sessionRedis.set(`username_cache:${username}`, userId, 'EX', 86400 * 30).catch(() => {});
            logger.info(`Cached username mapping: @${username} -> ${userId}`);
        }
        
        // Also cache first_name for better logging/UI when only ID is provided
        await sessionRedis.set(`user_name_cache:${userId}`, ctx.from.first_name, 'EX', 86400 * 30).catch(() => {});
    }
    return next();
};
