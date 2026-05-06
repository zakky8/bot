import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('goodbye', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            
            const msg = ctx.session.goodbyeMessage;
            const status = msg ? '✅ Enabled' : '❌ Disabled (Default)';

            await ctx.reply(
                `👋 <b>Goodbye Settings</b>\n\n` +
                `├ Status: ${status}\n` +
                `└ Message: ${msg || 'Default'}\n\n` +
                `Use /setgoodbye to set a custom message.\n` +
                `Use /resetgoodbye to reset.`, 
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('goodbye error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
