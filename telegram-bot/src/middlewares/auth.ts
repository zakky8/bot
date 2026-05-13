import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // DMs: only bot admins and the owner are allowed
  if (ctx.chat?.type === 'private') {
    const allowed = await isAdminOrOwner(ctx);
    if (!allowed) {
      await ctx.reply(
        '⚠️ I only work inside the project group.\n' +
        'Ask your question there with <code>/ask</code>.',
        { parse_mode: 'HTML' }
      );
      return;
    }
  }

  await next();
};
