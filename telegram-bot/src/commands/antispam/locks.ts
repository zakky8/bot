import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';
import { createLockKeyboard, getLockSummaryText } from './lockmenu';

export const LOCK_TYPES = [
  'all', 'story', 'photo', 'video', 'album', 'gif', 'voice', 'audio', 'sticker', 
  'animated_sticker', 'dice', 'animated_emoji', 'premium_emoji', 'document', 'giveaway',
  'game', 'contact', 'poll', 'keyboard', 'location', 'command', 'payment', 'bot', 
  'inline', 'url', 'forward', 'invitelink', 'video_note'
];

export default (bot: Bot<BotContext>) => {
  // ── /locks ──────────────────────────────────────────────────────────────
  bot.command('locks', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    // Delete the command message to keep the chat clean
    try { await ctx.deleteMessage(); } catch (e) {}

    await ctx.reply(
        getLockSummaryText(ctx.session.locks || {}),
        {
            parse_mode: 'HTML',
            reply_markup: createLockKeyboard(ctx)
        }
    );
  });

  // ── /lock ───────────────────────────────────────────────────────────────
  bot.command('lock', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const parts = ctx.message?.text?.split(' ') || [];
    const type = parts[1]?.toLowerCase();
    const mode = (parts[2]?.toLowerCase() || 'off') as any;

    if (!type) {
      return ctx.reply('❓ <b>Usage:</b> <code>/lock &lt;type&gt; [mode]</code>\nModes: <code>off, warn, mute, kick, ban</code>', { parse_mode: 'HTML' });
    }

    if (!LOCK_TYPES.includes(type)) {
      return ctx.reply(`❌ <b>Invalid type.</b>\nTry: <code>photo, sticker, links, etc.</code>`, { parse_mode: 'HTML' });
    }

    const validModes = ['off', 'warn', 'mute', 'kick', 'ban'];
    if (!validModes.includes(mode)) {
        return ctx.reply(`❌ <b>Invalid mode.</b>\nUse: <code>off, warn, mute, kick, ban</code>`, { parse_mode: 'HTML' });
    }

    ctx.session.locks[type] = {
        mode: mode,
        delete: mode !== 'off' // Default delete to true if any mode is set
    };

    await ctx.reply(`🔒 <b>Locked:</b> <code>${type}</code>\n└ Mode: <b>${mode}</b> | Deletion: <b>ON</b>`, { parse_mode: 'HTML' });
  });

  // ── /unlock ─────────────────────────────────────────────────────────────
  bot.command('unlock', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const type = ctx.message?.text?.split(' ')[1]?.toLowerCase();
    if (!type) return ctx.reply('❓ Specify type to unlock.');

    if (type === 'all') {
      ctx.session.locks = {};
      return ctx.reply('🔓 <b>Unlocked everything.</b>', { parse_mode: 'HTML' });
    }

    if (!LOCK_TYPES.includes(type)) return ctx.reply(`❌ Invalid type.`);

    ctx.session.locks[type] = { mode: 'off', delete: false };
    await ctx.reply(`🔓 <b>Unlocked:</b> <code>${type}</code>`, { parse_mode: 'HTML' });
  });
};
