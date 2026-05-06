import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('filter', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const keyword = args[0]?.toLowerCase();
            const response = args.slice(1).join(' ') || ctx.message?.reply_to_message?.text;
            if (!keyword || !response) return ctx.reply('Usage: /filter <keyword> <response>\nOr reply to a message: /filter <keyword>');
            
            if (!ctx.session.filters) ctx.session.filters = {};
            ctx.session.filters[keyword] = response;
            
            await ctx.reply(`✅ Filter added: <code>${keyword}</code> → ${response.substring(0, 100)}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('filter error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
