import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('captchatext', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some((a) => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const text = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!text) return ctx.reply('Usage: /captchatext <custom message>\n\nPlaceholders: {user} {chatname}\nDefault: "Please verify you are human"');

            ctx.session.captcha.text = text;

            await ctx.reply(`✅ CAPTCHA message set to:\n<i>${text}</i>`, { parse_mode: 'HTML' });
        } catch (error) { console.error('captchatext error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

