import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setgtitle', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const title = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!title) return ctx.reply('Usage: /setgtitle <new title>');
            await ctx.api.setChatTitle(targetChatId, title.substring(0, 128));
            await ctx.reply(`✅ Group title changed to: <b>${title.substring(0, 128)}</b>`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setgtitle error:', error); await ctx.reply('❌ Failed to set title.'); }
    });
};

