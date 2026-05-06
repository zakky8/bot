import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setwarnlimit', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const limit = parseInt(args[0]);
            if (isNaN(limit) || limit < 1 || limit > 20) return ctx.reply('Usage: /setwarnlimit <1-20>');
            await ctx.reply(`✅ Warning limit set to <b>${limit}</b>. Users will be banned after ${limit} warnings.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setwarnlimit error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

