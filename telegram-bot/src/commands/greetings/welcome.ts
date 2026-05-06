import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('welcome', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const msg = ctx.session.welcomeMessage;
            const captcha = ctx.session.captcha?.enabled ? '✅ On' : '❌ Off';
            await ctx.reply(
                `👋 <b>Welcome Settings</b>\n\n` +
                `├ Message: ${msg ? '<i>Custom</i>' : 'Default'}\n` +
                `└ CAPTCHA: ${captcha}\n\n` +
                (msg ? `<b>Current message:</b>\n<code>${msg}</code>\n\n` : '') +
                `Use /setwelcome to set a custom message.\nUse /resetwelcome to reset.\nPlaceholders: {user} {chatname} {count} {first} {id}`,
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('welcome error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
