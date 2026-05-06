import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setfloodmode', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;

            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
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
