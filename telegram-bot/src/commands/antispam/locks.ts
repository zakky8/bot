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

  bot.command('lock', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const parts = ctx.message?.text?.split(' ') || [];
    const type = parts[1]?.toLowerCase();
    const modeArg = parts[2]?.toLowerCase();

    if (!type) {
      return ctx.reply(
        '❓ <b>Usage:</b> <code>/lock &lt;type&gt; [mode]</code>\n' +
        'With no mode: deletes the content silently.\n' +
        'Modes: <code>warn, mute, kick, ban</code>\n\n' +
        'Run /locktypes to see all lockable types.',
        { parse_mode: 'HTML' }
      );
    }

    if (!LOCK_TYPES.includes(type)) {
      return ctx.reply(`❌ <b>Invalid type.</b> Run /locktypes to see all available types.`, { parse_mode: 'HTML' });
    }

    const validModes = ['warn', 'mute', 'kick', 'ban'];
    if (modeArg && !validModes.includes(modeArg)) {
        return ctx.reply(`❌ <b>Invalid mode.</b>\nUse: <code>warn, mute, kick, ban</code> — or omit for delete-only.`, { parse_mode: 'HTML' });
    }

    if (!ctx.session.locks) ctx.session.locks = {};

    const mode = (modeArg || 'off') as any;
    // No mode arg = delete only; with mode = delete + punish
    ctx.session.locks[type] = { mode, delete: true };

    const modeLabel = modeArg ? `delete + <b>${mode}</b>` : `<b>delete only</b>`;
    await ctx.reply(`🔒 <b>Locked:</b> <code>${type}</code>\n└ Action: ${modeLabel}`, { parse_mode: 'HTML' });
  });

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
