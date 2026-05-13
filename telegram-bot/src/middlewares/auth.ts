import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // DMs: only bot admins and the owner are allowed
  if (ctx.chat?.type === 'private') {
    const allowed = await isAdminOrOwner(ctx);
    if (!allowed) {
      await ctx.reply(
        '👋 Join the Astarter community and ask your questions there:\n\nhttps://t.me/AstarterDefiHubOfficial',
      );
      return;
    }
  }

  await next();
};
