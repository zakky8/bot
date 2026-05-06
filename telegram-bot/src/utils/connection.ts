/**
 * connection.ts — DM-to-group connection helpers
 *
 * When an admin uses /connect <group> in DM, all group-acting commands
 * should route to the connected group instead of blocking with "Groups only".
 *
 * Usage in any command:
 *   const target = await resolveGroupContext(ctx);
 *   if (!target) return; // already replied with error
 *   // use target.chatId for Telegram API calls
 */

import { BotContext } from '../types';

interface GroupContext {
  chatId: number;
  /** true when acting on a remote group via DM connection */
  isConnected: boolean;
}

/**
 * Returns the effective chat ID for group-acting commands.
 *
 * - In a group: returns the current chat ID immediately.
 * - In DM with an active /connect connection: returns the connected group's ID
 *   and verifies the user is still an admin there.
 * - In DM with no connection: replies with a helpful message and returns null.
 */
export async function resolveGroupContext(ctx: BotContext): Promise<GroupContext | null> {
  const chatType = ctx.chat?.type;

  // Already in a group — just use current chat
  if (chatType && chatType !== 'private') {
    return { chatId: ctx.chat!.id, isConnected: false };
  }

  // DM — check for an active connection
  try {
    const { sessionRedis } = require('../index') as { sessionRedis: import('ioredis').Redis };
    const raw = await sessionRedis.get(`user_connection:${ctx.from?.id}`);
    if (!raw) {
      await ctx.reply(
        '❌ This command works in groups.\n\n' +
        'To use it from DM, first connect to your group:\n' +
        '<code>/connect @yourgroupusername</code>',
        { parse_mode: 'HTML' }
      );
      return null;
    }

    const connectedChatId = parseInt(raw, 10);

    // Verify user is still an admin in the connected group
    const member = await ctx.api.getChatMember(connectedChatId, ctx.from!.id);
    if (!['creator', 'administrator'].includes(member.status)) {
      await ctx.reply('❌ You are no longer an admin in the connected group. Connection cleared.');
      await sessionRedis.del(`user_connection:${ctx.from!.id}`);
      return null;
    }

    return { chatId: connectedChatId, isConnected: true };
  } catch (err) {
    await ctx.reply('❌ Could not resolve group connection. Try /connect again.');
    return null;
  }
}
