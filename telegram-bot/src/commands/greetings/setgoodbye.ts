import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setgoodbye', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            }

            const text = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!text) return ctx.reply('Usage: /setgoodbye <message>\n\nPlaceholders: {user}, {chatname}, {first}, {id}');

            ctx.session.goodbyeMessage = text;

            await ctx.reply(`✅ Goodbye message set!`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setgoodbye error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
