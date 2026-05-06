import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';

/**
 * Helper to replace Rose-style fillings.
 */
export const applyFillings = async (ctx: BotContext, text: string): Promise<string> => {
  const user = ctx.from;
  if (!user) return text;

  let count = '?';
  try {
    if (ctx.chat) count = String(await ctx.api.getChatMemberCount(ctx.chat.id));
  } catch (e) {}

  return text
    .replace(/\{first\}/g, user.first_name)
    .replace(/\{last\}/g, user.last_name || '')
    .replace(/\{fullname\}/g, `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`)
    .replace(/\{username\}/g, user.username ? `@${user.username}` : user.first_name)
    .replace(/\{id\}/g, String(user.id))
    .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
    .replace(/\{count\}/g, count);
};

export const contentMiddleware = async (ctx: BotContext, next: NextFunction) => {
  if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();
  
  const isAdmin = await isAdminOrOwner(ctx);
  const isApproved = ctx.session.approvals?.includes(ctx.from.id);

  const text = (ctx.message?.text || ctx.message?.caption || '').toLowerCase();
  if (!text) return next();

  // 1. Blacklists (Admins/Approved are NOT immune unless set in settings)
  const blacklist = ctx.session.blacklist || [];
  for (const word of blacklist) {
    if (text.includes(word.toLowerCase())) {
      if (isAdmin || isApproved) continue; // Basic exemption

      await ctx.deleteMessage().catch(() => {});
      const mode = ctx.session.blacklistMode || 'delete';
      
      const mention = `<a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>`;
      if (mode === 'warn') {
        await ctx.reply(`⚠️ ${mention}, that word is blacklisted!`, { parse_mode: 'HTML' });
      } else if (mode === 'mute') {
        await ctx.restrictChatMember(ctx.from.id, { can_send_messages: false });
        await ctx.reply(`🔇 ${mention} muted for using blacklisted words.`, { parse_mode: 'HTML' });
      }
      return;
    }
  }

  // 2. Filters (Admins/Approved ARE immune)
  if (isAdmin || isApproved) return next();

  const filters = ctx.session.filters || {};
  for (const keyword of Object.keys(filters)) {
    if (text.includes(keyword.toLowerCase())) {
      const response = await applyFillings(ctx, filters[keyword]);
      await ctx.reply(response, { parse_mode: 'HTML' });
      return;
    }
  }

  return next();
};
