import { BotContext } from '../types';
import { sessionRedis } from '../index';

/**
 * Resolves a username or user ID to a numeric User ID and Name.
 * Checks Redis cache first, then current chat admins, then falls back to Telegram API.
 */
export async function resolveUser(ctx: BotContext, identifier: string): Promise<{ id: number; name: string } | null> {
    // 1. Check if it's already a numeric ID
    if (/^\d+$/.test(identifier)) {
        const id = parseInt(identifier);
        const name = await sessionRedis.get(`user_name_cache:${id}`).catch(() => null) || `User ${id}`;
        return { id, name };
    }

    // 2. Check if it's a username
    if (identifier.startsWith('@')) {
        const username = identifier.substring(1).toLowerCase();
        const usernameNoAt = identifier.substring(1);
        
        // A. Try Redis cache first (Most reliable for seen users)
        const cachedId = await sessionRedis.get(`username_cache:${username}`).catch(() => null);
        if (cachedId) {
            const id = parseInt(cachedId);
            const name = await sessionRedis.get(`user_name_cache:${id}`).catch(() => null) || identifier;
            return { id, name };
        }

        // B. Try scanning current chat administrators (Fast fallback for admins)
        if (ctx.chat && ctx.chat.type !== 'private') {
            try {
                const admins = await ctx.getChatAdministrators();
                const found = admins.find(a => 
                    a.user.username?.toLowerCase() === username || 
                    a.user.username === usernameNoAt
                );
                if (found) {
                    const id = found.user.id;
                    const name = found.user.first_name;
                    // Cache it for future use
                    await sessionRedis.set(`username_cache:${username}`, id, 'EX', 86400 * 30).catch(() => {});
                    await sessionRedis.set(`user_name_cache:${id}`, name, 'EX', 86400 * 30).catch(() => {});
                    return { id, name };
                }
            } catch (e) {
                // Ignore errors from getChatAdministrators
            }
        }

        // C. Fallback to Telegram API (getChat) - Only works if bot has "seen" user recently
        try {
            const chat = await ctx.api.getChat(identifier);
            const id = chat.id;
            const name = (chat as any).first_name || (chat as any).title || identifier;
            
            // Save to cache for next time
            await sessionRedis.set(`username_cache:${username}`, id, 'EX', 86400 * 30).catch(() => {});
            await sessionRedis.set(`user_name_cache:${id}`, (chat as any).first_name || name, 'EX', 86400 * 30).catch(() => {});
            
            return { id, name };
        } catch (e) {
            return null;
        }
    }

    return null;
}
