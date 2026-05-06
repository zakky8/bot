import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isBotAdmin } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // Layer 2a — DM block: only bot admins/owners may use DMs
  if (ctx.chat?.type === 'private' && !isBotAdmin(ctx)) {
    await ctx.reply('I only operate in the project group. Please ask your question there.');
    return;
  }

  // Layer 2b — File ignore: silently drop attachments sent by members in groups
  if (ctx.chat?.type !== 'private' && !isBotAdmin(ctx)) {
    const msg = ctx.message;
    if (
      msg?.document || msg?.photo || msg?.video ||
      msg?.audio || msg?.voice || msg?.video_note ||
      msg?.sticker || msg?.animation
    ) {
      return; // Silently ignore — never process member-sent files
    }
  }

  await next();
};
