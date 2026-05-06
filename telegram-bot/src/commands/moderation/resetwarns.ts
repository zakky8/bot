import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';

export default (bot: Bot<BotContext>) => {
    bot.command('resetwarns', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to a user to reset their warnings.');

            await query('DELETE FROM warnings WHERE user_id = $1 AND chat_id = $2', [reply.from.id, ctx.chat.id]);
            await ctx.reply(`✅ All warnings for <b>${reply.from.first_name}</b> have been cleared.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('resetwarns error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
