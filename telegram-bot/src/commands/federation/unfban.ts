import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { isAdminOrOwner } from '../../utils/permissions';
import { sendLog } from '../../utils';

export default (bot: Bot<BotContext>) => {
    bot.command('unfban', async (ctx: BotContext) => {
        try {
            if (!ctx.chat) return;
            if (!(await isAdminOrOwner(ctx))) return;

            const fedId = ctx.session.federations?.current;
            if (!fedId) {
                return ctx.reply('❌ This chat is not in any federation. Use <code>/joinfed</code> first.', { parse_mode: 'HTML' });
            }

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to a user to federation unban them.');

            const target = reply.from;

            // Remove from DB
            const result = await query(
                'DELETE FROM federation_bans WHERE federation_id = $1 AND user_id = $2',
                [fedId, target.id]
            );

            if ((result.rowCount ?? 0) === 0) {
                return ctx.reply(`⚠️ <b>${target.first_name}</b> is not currently federation-banned.`, { parse_mode: 'HTML' });
            }

            await ctx.reply(
                `✅ <b>Federation Unban</b>\n\n` +
                `└ <b>${target.first_name}</b> (<code>${target.id}</code>) has been removed from the federation ban list.`,
                { parse_mode: 'HTML' }
            );
            await sendLog(ctx, `✅ <b>FUnban Action</b>\n├ Fed: <code>${fedId}</code>\n└ Target: ${target.first_name}`);
        } catch (error) { console.error('unfban error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
