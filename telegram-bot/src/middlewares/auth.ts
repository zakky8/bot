import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isAdminOrOwner } from '../utils/permissions';

// Commands that any user can run in DMs (no admin required)
const PUBLIC_DM_COMMANDS = new Set(['ask', 'ai', 'support', 'start', 'help', 'ping']);

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  if (ctx.chat?.type === 'private') {
    // Allow public commands for everyone in DMs
    const command = ctx.message?.text?.match(/^\/(\w+)/)?.[1]?.toLowerCase();
    if (command && PUBLIC_DM_COMMANDS.has(command)) {
      return next();
    }

    // All other DM interactions require admin/owner
    const allowed = await isAdminOrOwner(ctx);
    if (!allowed) {
      await ctx.reply(
        '⚠️ That command is only available to group admins.\n' +
        'Use <code>/ask</code> to chat with the AI assistant or <code>/support</code> to reach a moderator.',
        { parse_mode: 'HTML' }
      );
      return;
    }
  }

  await next();
};
