import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // In DMs: allow bot admins, the owner, AND group admins connected via /connect
  if (ctx.chat?.type === 'private') {
    const allowed = await isAdminOrOwner(ctx);
    if (!allowed) {
      await ctx.reply(
        '⚠️ I only work inside the project group.\n' +
        'Ask your question there with <code>/ask</code>, or connect as an admin with <code>/connect &lt;groupId&gt;</code>.',
        { parse_mode: 'HTML' }
      );
      return;
    }
  }

  await next();
};
