import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('stop', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const keyword = ctx.message?.text?.split(' ').slice(1).join(' ')?.toLowerCase();
            if (!keyword) return ctx.reply('Usage: /stop <keyword>');
            
            const filters = ctx.session.filters || {};
            if (filters[keyword]) {
                delete filters[keyword];
                ctx.session.filters = filters;
                await ctx.reply(`✅ Filter <code>${keyword}</code> removed.`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`❌ Filter <code>${keyword}</code> not found.`, { parse_mode: 'HTML' });
            }
        } catch (error) { console.error('stop error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
