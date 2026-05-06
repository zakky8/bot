import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setdesc', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const desc = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!desc) return ctx.reply('Usage: /setdesc <description>');
            await ctx.api.setChatDescription(targetChatId, desc.substring(0, 255));
            await ctx.reply('✅ Group description updated!');
        } catch (error) { console.error('setdesc error:', error); await ctx.reply('❌ Failed to set description.'); }
    });
};

