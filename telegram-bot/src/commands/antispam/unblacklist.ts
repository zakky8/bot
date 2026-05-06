import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('unblacklist', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const word = ctx.message?.text?.split(' ').slice(1).join(' ')?.toLowerCase();
            if (!word) return ctx.reply('Usage: /unblacklist <word or phrase>');
            
            if (!ctx.session.blacklist) ctx.session.blacklist = [];
            const idx = ctx.session.blacklist.indexOf(word);
            if (idx === -1) return ctx.reply(`❌ <code>${word}</code> is not in the blacklist.`, { parse_mode: 'HTML' });
            
            ctx.session.blacklist.splice(idx, 1);
            await ctx.reply(`✅ Removed <code>${word}</code> from the blacklist.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('unblacklist error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
