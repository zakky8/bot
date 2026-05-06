import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setfloodmode', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            }

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();

            if (!mode || !['mute', 'kick', 'ban'].includes(mode)) {
                return ctx.reply('Usage: /setfloodmode <mute|kick|ban>');
            }

            ctx.session.flood.action = mode as 'mute' | 'kick' | 'ban';

            await ctx.reply(`🌊 Flood action set to <b>${mode}</b>.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setfloodmode error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
