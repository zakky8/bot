import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('resetgoodbye', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            }

            ctx.session.goodbyeMessage = undefined;

            await ctx.reply(`✅ Goodbye message reset to default (Disabled).`, { parse_mode: 'HTML' });
        } catch (error) { console.error('resetgoodbye error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
