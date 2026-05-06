import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('captchakick', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const minutes = parseInt(args[0]);
            if (isNaN(minutes) || minutes < 1 || minutes > 60) return ctx.reply('Usage: /captchakick <1-60 minutes>\nTime before unverified users are kicked.');
            await ctx.reply(`⏰ Users who don't verify within <b>${minutes}</b> minute(s) will be kicked.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('captchakick error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

