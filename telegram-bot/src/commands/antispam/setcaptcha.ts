import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setcaptcha', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;

            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some((a) => a.user.id === ctx.from?.id)) {
                const msg = await ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' });
                setTimeout(() => {
                    ctx.api.deleteMessage(target.chatId, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode)) {
                return ctx.reply('Usage: /setcaptcha <on|off>\n\nEnables or disables CAPTCHA verification for new members.');
            }

            if (!ctx.session.captcha) ctx.session.captcha = { enabled: false, mode: 'button' };
            ctx.session.captcha.enabled = (mode === 'on');

            await ctx.reply(
                mode === 'on'
                    ? '🔐 CAPTCHA verification <b>enabled</b>.\n\nNew members must verify before they can chat.\nUse /captchamode to switch between button and math modes.'
                    : '🔓 CAPTCHA verification <b>disabled</b>.\n\nNew members can chat immediately.',
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('setcaptcha error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
