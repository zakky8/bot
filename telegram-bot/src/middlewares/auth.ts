import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isBotAdmin } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // Layer 2a — DM block: only bot admins/owners may use DMs
  if (ctx.chat?.type === 'private' && !isBotAdmin(ctx)) {
    await ctx.reply('I only operate in the project group. Please ask your question there.');
    return;
  }

  // Note: media is NOT dropped here — locks middleware handles content enforcement.
  await next();
};
