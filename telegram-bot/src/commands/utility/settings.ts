import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('settings', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            const s = ctx.session;

            const bool  = (v: boolean | undefined) => v ? '✅' : '❌';
            const flood  = s.flood?.limit > 0
                ? `✅ ${s.flood.limit} msg/${s.flood.interval}s → ${s.flood.action}`
                : '❌ Disabled';
            const captcha = s.captcha?.enabled
                ? `✅ ${s.captcha.mode}${s.captcha.kickTime ? ` (kick ${s.captcha.kickTime}m)` : ''}`
                : '❌ Disabled';
            const warnLimit = s.warnLimit ?? 3;
            const warnMode  = s.warnMode  ?? 'ban';
            const filterCount = Object.keys(s.filters || {}).length;
            const noteCount   = Object.keys(s.notes   || {}).length;
            const blackCount  = (s.blacklist || []).length;
            const lockCount   = Object.values(s.locks || {}).filter(l => l.delete || l.mode !== 'off').length;

            await ctx.reply(
                `⚙️ <b>Group Settings</b>\n\n` +
                `<b>Greetings</b>\n` +
                `├ Welcome: ${s.welcomeMessage ? '✅ Set' : '❌ Not set'}\n` +
                `├ Goodbye: ${s.goodbyeMessage ? '✅ Set' : '❌ Not set'}\n` +
                `├ Clean Service Msgs: ${bool(s.cleanService ?? true)}\n` +
                `└ Clean Welcome: ${bool(s.cleanWelcome)}\n\n` +
                `<b>Moderation</b>\n` +
                `├ Warn Limit: ${warnLimit} warns → ${warnMode}\n` +
                `├ CAPTCHA: ${captcha}\n` +
                `├ Anti-Flood: ${flood}\n` +
                `├ Anti-Raid: ${bool(s.antiraid?.enabled)}\n` +
                `└ Locks: ${lockCount} active\n\n` +
                `<b>Content</b>\n` +
                `├ Filters: ${filterCount} active\n` +
                `├ Notes: ${noteCount} saved\n` +
                `├ Blacklist: ${blackCount} words (mode: ${s.blacklistMode || 'delete'})\n` +
                `└ Rules: ${s.rules ? '✅ Set' : '❌ Not set'}\n\n` +
                `<b>System</b>\n` +
                `├ Log Channel: ${s.logChannel ? `<code>${s.logChannel}</code>` : 'Not set'}\n` +
                `└ Federation: ${s.federations?.current || 'None'}`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('settings error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
