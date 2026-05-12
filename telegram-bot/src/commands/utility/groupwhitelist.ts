import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isBotAdmin, isOwner, denyAccess } from '../../utils/permissions';
import {
  addGroupToWhitelist,
  removeGroupFromWhitelist,
  getWhitelistedGroups,
  isGroupWhitelisted,
} from '../../utils/groupWhitelist';
import { createLogger } from '../../core/logger';

const logger = createLogger('GroupWhitelist');

export default (bot: Bot<BotContext>) => {

  // ── /addgroup ──────────────────────────────────────────────────────────────
  // Owner or bot admin can authorize a group.
  // Usage:
  //   Inside the group:  /addgroup          (adds current group)
  //   From anywhere:     /addgroup -1001234567890  (adds by ID)
  bot.command('addgroup', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx)) return denyAccess(ctx, true);

    const arg = (ctx.match as string)?.trim();
    let targetId: string;
    let targetTitle: string;

    if (arg && /^-?\d+$/.test(arg)) {
      // ID provided explicitly
      targetId = arg;
      targetTitle = `Group ${arg}`;
    } else if (ctx.chat && ctx.chat.type !== 'private') {
      // Inside a group — authorize the current group
      targetId = ctx.chat.id.toString();
      targetTitle = (ctx.chat as any).title || `Group ${targetId}`;
    } else {
      return ctx.reply(
        '📝 <b>Usage:</b>\n' +
        '• Run <code>/addgroup</code> inside the group you want to authorize\n' +
        '• Or: <code>/addgroup &lt;groupId&gt;</code>',
        { parse_mode: 'HTML' }
      );
    }

    const addedBy = ctx.from?.id?.toString() || 'unknown';
    const added = addGroupToWhitelist(targetId, targetTitle, addedBy);

    if (!added) {
      return ctx.reply(
        `ℹ️ Group <b>${targetTitle}</b> (<code>${targetId}</code>) is already authorized.`,
        { parse_mode: 'HTML' }
      );
    }

    logger.info(`Group ${targetId} (${targetTitle}) added to whitelist by ${addedBy}`);
    return ctx.reply(
      `✅ <b>Group Authorized</b>\n\n` +
      `<b>${targetTitle}</b>\n` +
      `ID: <code>${targetId}</code>\n\n` +
      `The bot will now respond to members in this group.`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /removegroup ───────────────────────────────────────────────────────────
  // Only owner can remove a group.
  // Usage:
  //   Inside the group:  /removegroup
  //   From anywhere:     /removegroup -1001234567890
  bot.command('removegroup', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);

    const arg = (ctx.match as string)?.trim();
    let targetId: string;

    if (arg && /^-?\d+$/.test(arg)) {
      targetId = arg;
    } else if (ctx.chat && ctx.chat.type !== 'private') {
      targetId = ctx.chat.id.toString();
    } else {
      return ctx.reply(
        '📝 Usage: <code>/removegroup &lt;groupId&gt;</code> or run inside the group.',
        { parse_mode: 'HTML' }
      );
    }

    const removed = removeGroupFromWhitelist(targetId);

    if (!removed) {
      return ctx.reply(
        `ℹ️ Group <code>${targetId}</code> was not in the whitelist.`,
        { parse_mode: 'HTML' }
      );
    }

    logger.info(`Group ${targetId} removed from whitelist by ${ctx.from?.id}`);
    return ctx.reply(
      `⛔ <b>Group Removed</b>\n\nGroup <code>${targetId}</code> has been deauthorized. The bot will no longer respond there.`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /listgroups ────────────────────────────────────────────────────────────
  // Owner only — see all authorized groups.
  bot.command('listgroups', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);

    const groups = getWhitelistedGroups();
    if (groups.length === 0) {
      return ctx.reply(
        '📋 <b>No authorized groups yet.</b>\n\nUse <code>/addgroup</code> inside a group to authorize it.',
        { parse_mode: 'HTML' }
      );
    }

    const lines = groups.map((g, i) =>
      `${i + 1}. <b>${g.title}</b>\n   ID: <code>${g.chatId}</code>\n   Added: ${g.addedAt.split('T')[0]}`
    );

    return ctx.reply(
      `📋 <b>Authorized Groups (${groups.length})</b>\n\n${lines.join('\n\n')}`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /groupstatus ───────────────────────────────────────────────────────────
  // Check if the current group is authorized (useful for admins to verify).
  bot.command('groupstatus', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx)) return denyAccess(ctx, true);

    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('ℹ️ Run this command inside a group to check its status.');
    }

    const chatId = ctx.chat.id.toString();
    const whitelisted = isGroupWhitelisted(chatId);
    const title = (ctx.chat as any).title || chatId;

    return ctx.reply(
      `${whitelisted ? '✅' : '❌'} <b>${title}</b>\n` +
      `ID: <code>${chatId}</code>\n` +
      `Status: <b>${whitelisted ? 'Authorized ✅' : 'Not authorized ❌'}</b>\n\n` +
      (whitelisted ? '' : `To authorize: <code>/addgroup</code>`),
      { parse_mode: 'HTML' }
    );
  });
};
