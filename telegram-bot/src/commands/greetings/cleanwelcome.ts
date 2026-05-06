import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('cleanwelcome', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode))
                return ctx.reply('Usage: /cleanwelcome <on|off>\nAuto-delete old welcome messages when a new member joins.');

            ctx.session.cleanWelcome = (mode === 'on');
            await ctx.reply(
                mode === 'on'
                    ? '✅ <b>Clean welcome enabled.</b>\nOld welcome messages will be deleted on each new join.'
                    : '✅ <b>Clean welcome disabled.</b>',
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('cleanwelcome error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
