import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('cleanservice', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.', { parse_mode: 'HTML' });

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode))
                return ctx.reply('Usage: /cleanservice <on|off>\nAuto-delete "user joined/left" Telegram service messages.');

            ctx.session.cleanService = (mode === 'on');
            await ctx.reply(
                mode === 'on'
                    ? '✅ <b>Clean service messages enabled.</b>\nJoin/leave notifications will be auto-deleted.'
                    : '✅ <b>Clean service messages disabled.</b>',
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('cleanservice error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
