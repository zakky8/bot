import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isGroupWhitelisted } from '../utils/groupWhitelist';
import { isBotAdmin } from '../utils/permissions';

/**
 * Group Whitelist Middleware
 *
 * Blocks the bot from responding in any group that hasn't been
 * authorized by the owner or a bot admin via /addgroup.
 *
 * Exceptions (always allowed):
 *  - Private chats (DMs)
 *  - /addgroup command — so owner/bot admin can authorize the group
 *  - Owner and bot admins (can always use the bot everywhere)
 */
export const groupWhitelistMiddleware = async (ctx: BotContext, next: NextFunction) => {
  const chatType = ctx.chat?.type;

  // Allow DMs through — auth middleware handles those
  if (!chatType || chatType === 'private') {
    return next();
  }

  // Owner and bot admins bypass the whitelist
  if (isBotAdmin(ctx)) {
    return next();
  }

  // Allow /addgroup so the owner can authorize from inside the group
  const text = ctx.message?.text || '';
  if (text.startsWith('/addgroup')) {
    return next();
  }

  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return next();

  if (!isGroupWhitelisted(chatId)) {
    // Silently ignore — do not reply or spam unauthorized groups
    return;
  }

  return next();
};

/**
 * Bot Added to Group Handler
 *
 * When the bot is added to a new group, check if it's whitelisted.
 * If not: notify the owner via DM and leave the group.
 */
export function registerBotMemberHandler(bot: any) {
  bot.on('my_chat_member', async (ctx: BotContext) => {
    const update = ctx.myChatMember;
    if (!update) return;

    const newStatus = update.new_chat_member?.status;
    const chatId = ctx.chat?.id;
    const chatTitle = (ctx.chat as any)?.title || 'Unknown Group';

    // Bot was added to a group
    if (
      (newStatus === 'member' || newStatus === 'administrator') &&
      ctx.chat?.type !== 'private'
    ) {
      if (!isGroupWhitelisted(chatId!)) {
        const ownerId = process.env.OWNER_ID;

        // Notify owner via DM
        const ownerIdNum = ownerId ? parseInt(ownerId, 10) : NaN;
        if (!Number.isNaN(ownerIdNum)) {
          await ctx.api.sendMessage(
            ownerIdNum,
            `⚠️ <b>Unauthorized Group Added</b>\n\n` +
            `Bot was added to: <b>${chatTitle}</b>\n` +
            `Chat ID: <code>${chatId}</code>\n\n` +
            `To authorize this group, use:\n<code>/addgroup ${chatId}</code>`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }

        // Leave the unauthorized group
        await ctx.api.sendMessage(
          chatId!,
          '⛔ This bot is not authorized for this group. Contact the bot owner to get access.',
        ).catch(() => {});

        await ctx.api.leaveChat(chatId!).catch(() => {});
      }
    }
  });
}
