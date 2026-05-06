import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setflood', async (ctx: BotContext) => {
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
            const limit = parseInt(args[0]);

            if (isNaN(limit) || limit < 0 || limit > 100) {
                return ctx.reply('Usage: /setflood <0-100>\nSet to 0 to disable flood detection.');
            }

            ctx.session.flood.limit = limit;

            if (limit === 0) {
                return ctx.reply('🌊 Flood detection <b>disabled</b>.', { parse_mode: 'HTML' });
            }

            await ctx.reply(
                `🌊 Flood limit set to <b>${limit}</b> messages.\n` +
                `Users sending more than ${limit} messages in ${ctx.session.flood.interval}s will be actioned.`, 
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('setflood error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
