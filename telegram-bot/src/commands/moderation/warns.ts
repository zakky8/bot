import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('warns', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');

            const reply = ctx.message?.reply_to_message;
            const targetId   = reply?.from?.id   ?? ctx.from?.id;
            const targetName = reply?.from?.first_name ?? ctx.from?.first_name ?? 'User';

            if (!targetId) return ctx.reply('❌ Reply to a user or use in a group.');

            const warnLimit = ctx.session.warnLimit ?? 3;
            const userWarns = ctx.session.warnings?.[targetId] ?? [];

            if (userWarns.length === 0) {
                return ctx.reply(`✅ <b>${targetName}</b> has no warnings.`, { parse_mode: 'HTML' });
            }

            const list = userWarns.map((w, i) =>
                `${i + 1}. ${w.reason} — by ${w.by} (${new Date(w.date).toLocaleDateString()})`
            ).join('\n');

            await ctx.reply(
                `⚠️ <b>Warnings for ${targetName}:</b>\n\n${list}\n\n<b>Total:</b> ${userWarns.length}/${warnLimit}`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('warns error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
