import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('captchakick', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            const args = ctx.message?.text?.split(' ').slice(1) || [];

            // /captchakick off — disable kick timeout
            if (args[0]?.toLowerCase() === 'off') {
                if (!ctx.session.captcha) ctx.session.captcha = { enabled: false, mode: 'button' };
                ctx.session.captcha.kickTime = undefined;
                return ctx.reply('✅ <b>Captcha kick timeout disabled.</b>\nUnverified users will not be kicked automatically.', { parse_mode: 'HTML' });
            }

            const minutes = parseInt(args[0]);
            if (isNaN(minutes) || minutes < 1 || minutes > 60)
                return ctx.reply('Usage: /captchakick <1-60 | off>\nTime limit for completing captcha before being kicked.');

            if (!ctx.session.captcha) ctx.session.captcha = { enabled: false, mode: 'button' };
            ctx.session.captcha.kickTime = minutes;

            await ctx.reply(
                `⏰ <b>Captcha kick set to ${minutes} minute(s).</b>\nUsers who don't verify within this time will be kicked.`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('captchakick error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
