import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('purgefrom', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to a user\'s message to purge all their recent messages.');

            const targetId = reply.from.id;
            const chatId = ctx.chat.id;
            const startId = reply.message_id;
            const endId = ctx.message?.message_id || startId;
            let deleted = 0;

            // This is limited by Telegram API - we can only try deleting by ID
            for (let i = startId; i <= endId; i++) {
                try { await ctx.api.deleteMessage(chatId, i); deleted++; } catch { /* ignore */ }
            }

            const statusMsg = await ctx.reply(`🗑️ Purged <b>${deleted}</b> messages from <b>${reply.from.first_name}</b>.`, { parse_mode: 'HTML' });
            setTimeout(() => ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => { /* ignore */ }), 5000);
        } catch (error) { console.error('purgefrom error:', error); await ctx.reply('❌ Failed to purge.'); }
    });
};

