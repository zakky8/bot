import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { sendLog } from '../../utils';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setlog', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;

            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> Administrative privileges required.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            }

            ctx.session.logChannel = targetChatId;

            await ctx.reply(`📋 Log channel set to this chat (ID: <code>${targetChatId}</code>).\nAdmin actions will be logged here.`, { parse_mode: 'HTML' });

            await sendLog(ctx, `Admin <a href="tg://user?id=${ctx.from?.id}">${ctx.from?.first_name}</a> enabled logging in this channel.`);
        } catch (error) { console.error('setlog error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
