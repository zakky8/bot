import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';
import { createLogger } from '../core/logger';

const logger = createLogger('FloodMiddleware');
const floodTrack = new Map<string, number[]>();

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
    } catch (e) {}
  }

  return next();
};
