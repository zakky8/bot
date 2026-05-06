import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';

export default (bot: Bot<BotContext>) => {
    bot.command('warns', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const reply = ctx.message?.reply_to_message;
            const targetId = reply?.from?.id || ctx.from?.id;
            if (!targetId) return ctx.reply('❌ Reply to a user or use in a group.');

            const result = await query(
                'SELECT reason, warned_by, created_at FROM warnings WHERE user_id = $1 AND chat_id = $2 ORDER BY created_at ASC',
                [targetId, ctx.chat.id]
            );

            if (result.rows.length === 0) return ctx.reply('✅ This user has no warnings.');

            const list = result.rows.map((w, i) => `${i + 1}. ${w.reason} (by ${w.warned_by}, ${new Date(w.created_at).toLocaleDateString()})`).join('\n');
            await ctx.reply(`⚠️ <b>Warnings for ${reply?.from?.first_name || 'user'}:</b>\n\n${list}\n\n<b>Total:</b> ${result.rows.length}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('warns error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
