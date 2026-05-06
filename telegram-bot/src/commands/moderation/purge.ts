import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('purge', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const count = parseInt(args[0]) || 10;
            if (count < 1 || count > 100) return ctx.reply('Usage: /purge <1-100>');

            const reply = ctx.message?.reply_to_message;
            const chatId = ctx.chat.id;
            const messageId = ctx.message?.message_id;
            if (!messageId) return;

            // Delete messages from current backwards
            let deleted = 0;
            const startId = reply?.message_id || messageId;
            for (let i = 0; i < count; i++) {
                try {
                    await ctx.api.deleteMessage(chatId, startId - i);
                    deleted++;
                } catch { /* Message may not exist */ }
            }

            const statusMsg = await ctx.reply(`🗑️ Purged <b>${deleted}</b> messages.`, { parse_mode: 'HTML' });
            setTimeout(() => ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => { /* ignore */ }), 5000);
        } catch (error) { console.error('purge error:', error); await ctx.reply('❌ Failed to purge messages.'); }
    });
};

