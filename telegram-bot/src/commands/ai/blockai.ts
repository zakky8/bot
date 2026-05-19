import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isOwner, isBotAdmin, denyAccess, getBotAdmins } from '../../utils/permissions';
import {
  isAiBlocked,
  blockAiUser,
  unblockAiUser,
  listBlockedAiUsers,
  blockedAiUserCount,
} from '../../utils/aiBlocklist';

/**
 * Two ways to identify the target user:
 *  1. Reply to the target's message → uses ctx.message.reply_to_message.from.id
 *  2. Type the user ID after the command → /blockai 123456789
 */
function resolveTarget(ctx: BotContext): { id: number; label: string } | null {
  const replyMsg = ctx.message?.reply_to_message;
  if (replyMsg?.from) {
    const u = replyMsg.from;
    const label = u.username ? `@${u.username}` : (u.first_name || `user ${u.id}`);
    return { id: u.id, label };
  }
  const typed = (ctx.match as string)?.trim();
  if (typed) {
    const parsed = parseInt(typed.replace(/[^\d-]/g, ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { id: parsed, label: `user <code>${parsed}</code>` };
    }
  }
  return null;
}

/** Refuses to block bot admins/owner — guard against locking yourself out. */
function isProtectedFromBlock(userId: number): boolean {
  const adminIds = getBotAdmins()
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n));
  if (adminIds.includes(userId)) return true;
  const ownerEnv = process.env.OWNER_ID;
  if (ownerEnv) {
    const ownerId = parseInt(ownerEnv, 10);
    if (Number.isFinite(ownerId) && ownerId === userId) return true;
  }
  const extraAdminEnv = process.env.ADMIN_IDS || '';
  for (const part of extraAdminEnv.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n === userId) return true;
  }
  return false;
}

export default (bot: Bot<BotContext>) => {
  // ── /blockai — block a user from /ask and /ai ──────────────────────────────
  bot.command('blockai', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx) && !isOwner(ctx)) return denyAccess(ctx, true);

    const target = resolveTarget(ctx);
    if (!target) {
      return ctx.reply(
        `💬 Usage:\n• Reply to a user's message with <code>/blockai</code>\n• OR <code>/blockai &lt;user_id&gt;</code>`,
        { parse_mode: 'HTML' }
      );
    }

    if (isProtectedFromBlock(target.id)) {
      return ctx.reply(
        `⚠️ ${target.label} is a bot admin or owner — cannot be blocked.`,
        { parse_mode: 'HTML' }
      );
    }

    const newlyBlocked = blockAiUser(target.id);
    if (!newlyBlocked) {
      return ctx.reply(
        `ℹ️ ${target.label} is already blocked from AI commands.`,
        { parse_mode: 'HTML' }
      );
    }

    return ctx.reply(
      `🚫 ${target.label} blocked from <code>/ask</code> and <code>/ai</code>.\nID: <code>${target.id}</code>`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /unblockai — remove a user from the blocklist ──────────────────────────
  bot.command('unblockai', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx) && !isOwner(ctx)) return denyAccess(ctx, true);

    const target = resolveTarget(ctx);
    if (!target) {
      return ctx.reply(
        `💬 Usage:\n• Reply to a user's message with <code>/unblockai</code>\n• OR <code>/unblockai &lt;user_id&gt;</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const removed = unblockAiUser(target.id);
    if (!removed) {
      return ctx.reply(
        `ℹ️ ${target.label} wasn't on the blocklist.`,
        { parse_mode: 'HTML' }
      );
    }

    return ctx.reply(
      `✅ ${target.label} unblocked — can use AI commands again.`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /blocklist — show all blocked users ────────────────────────────────────
  bot.command('blocklist', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx) && !isOwner(ctx)) return denyAccess(ctx, true);

    const ids = listBlockedAiUsers();
    if (ids.length === 0) {
      return ctx.reply('📋 No users are currently blocked from AI commands.');
    }

    const lines = ids.map((id, i) => `${i + 1}. <code>${id}</code>`).join('\n');
    return ctx.reply(
      `🚫 <b>AI-blocked users (${ids.length}):</b>\n\n${lines}\n\n` +
        `Unblock with <code>/unblockai &lt;user_id&gt;</code>`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /isblocked — quick check (for debugging) ───────────────────────────────
  bot.command('isblocked', async (ctx: BotContext) => {
    if (!isBotAdmin(ctx) && !isOwner(ctx)) return denyAccess(ctx, true);

    const target = resolveTarget(ctx);
    if (!target) {
      return ctx.reply(
        `💬 Usage: reply to a user with <code>/isblocked</code>, or <code>/isblocked &lt;user_id&gt;</code>`,
        { parse_mode: 'HTML' }
      );
    }
    const blocked = isAiBlocked(target.id);
    return ctx.reply(
      blocked
        ? `🚫 ${target.label} IS blocked from AI commands.`
        : `✅ ${target.label} is NOT blocked. Currently blocked count: ${blockedAiUserCount()}.`,
      { parse_mode: 'HTML' }
    );
  });
};
