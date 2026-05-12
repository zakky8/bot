import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';
import { createLogger } from '../core/logger';

const logger = createLogger('FloodMiddleware');
const floodTrack = new Map<string, number[]>();

// Purge entries that haven't had activity in the last 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, timestamps] of floodTrack) {
    if (timestamps.every(ts => ts < cutoff)) floodTrack.delete(key);
  }
}, 5 * 60 * 1000);

export const floodMiddleware = async (ctx: BotContext, next: NextFunction) => {
  if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();
  
  // Admins and Approved users are immune
  if (await isAdminOrOwner(ctx)) return next();
  if (ctx.session.approvals?.includes(ctx.from.id)) return next();

  const flood = ctx.session.flood;
  if (!flood || flood.limit <= 0) return next();

  const now = Date.now();
  const userId = ctx.from.id;
  const key = `${ctx.chat.id}:${userId}`;
  const userHistory = floodTrack.get(key) || [];
  
  userHistory.push(now);
  const intervalMs = flood.interval * 1000;
  const validTimestamps = userHistory.filter(ts => now - ts < intervalMs);
  floodTrack.set(key, validTimestamps);

  if (validTimestamps.length > flood.limit) {
    logger.warn(`Flood detected: user ${userId} in chat ${ctx.chat.id}`);
    
    try {
      if (flood.action === 'mute') {
        await ctx.restrictChatMember(userId, { can_send_messages: false });
        await ctx.reply(`🔇 <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> muted for flooding.`, { parse_mode: 'HTML' });
      } else if (flood.action === 'kick') {
        await ctx.banChatMember(userId);
        await ctx.unbanChatMember(userId);
        await ctx.reply(`👢 <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> kicked for flooding.`, { parse_mode: 'HTML' });
      } else if (flood.action === 'ban') {
        await ctx.banChatMember(userId);
        await ctx.reply(`🚫 <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> banned for flooding.`, { parse_mode: 'HTML' });
      }
      
      await ctx.deleteMessage().catch(() => {});
      return; 
    } catch (e) {
      logger.error(`Flood action failed for user ${userId}: ${e}`);
    }
  }

  return next();
};
