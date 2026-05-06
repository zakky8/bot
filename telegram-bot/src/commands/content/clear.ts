import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('clear', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            
            const name = ctx.message?.text?.split(' ')[1]?.toLowerCase();
            if (!name) return ctx.reply('Usage: /clear <name>');
            
            const notes = ctx.session.notes || {};
            if (notes[name]) {
                delete notes[name];
                ctx.session.notes = notes;
                await ctx.reply(`✅ Note <code>${name}</code> deleted.`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`❌ Note <code>${name}</code> not found.`, { parse_mode: 'HTML' });
            }
        } catch (error) { console.error('clear error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
