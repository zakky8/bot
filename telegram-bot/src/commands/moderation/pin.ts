import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('pin', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const reply = ctx.message?.reply_to_message;
            if (!reply) return ctx.reply('❌ Reply to a message to pin it.');
            await ctx.pinChatMessage(reply.message_id);
            await ctx.reply('📌 Message pinned!');
        } catch (error) { console.error('pin error:', error); await ctx.reply('❌ Failed to pin message.'); }
    });
};

