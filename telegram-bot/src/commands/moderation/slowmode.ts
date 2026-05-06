import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('slowmode', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            }

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const seconds = parseInt(args[0]);

            if (isNaN(seconds) || seconds < 0 || seconds > 86400) {
                return ctx.reply('Usage: /slowmode <0-86400 seconds>\nSet to 0 to disable.');
            }

            // Set slow mode via Telegram API
            await ctx.api.setChatSlowMode(ctx.chat.id, seconds);
            
            await ctx.reply(
                seconds > 0 
                ? `🐌 Slowmode enabled: users must wait <b>${seconds}</b>s between messages.` 
                : '🐌 Slowmode disabled.', 
                { parse_mode: 'HTML' }
            );
        } catch (error) { 
            console.error('slowmode error:', error); 
            await ctx.reply('❌ Failed to set slowmode. Make sure the bot has permission to "Change Group Info".'); 
        }
    });
};
