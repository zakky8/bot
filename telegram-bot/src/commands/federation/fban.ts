import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { isAdminOrOwner } from '../../utils/permissions';
import { sendLog } from '../../utils';

export default (bot: Bot<BotContext>) => {
  bot.command('fban', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    // Get current fed ID from session or database
    const fedId = ctx.session.federations?.current;
    if (!fedId) {
      return ctx.reply('❌ This chat is not connected to any federation. Use <code>/joinfed</code> first.', { parse_mode: 'HTML' });
    }

    const reply = ctx.message?.reply_to_message;
    if (!reply?.from) return ctx.reply('❌ Reply to a user to f-ban them.');

    const target = reply.from;
    const reason = ctx.message?.text?.split(' ').slice(1).join(' ') || 'No reason provided';

    try {
      // 1. Check if user is already fbanned
      const existing = await query(
        'SELECT 1 FROM federation_bans WHERE federation_id = $1 AND user_id = $2',
        [fedId, target.id]
      );
      if (existing.rowCount! > 0) return ctx.reply('⚠️ User is already fbanned in this federation.');

      // 2. Save ban to DB
      await query(
        'INSERT INTO federation_bans (federation_id, user_id, reason, banned_by) VALUES ($1, $2, $3, $4)',
        [fedId, target.id, reason, ctx.from!.id]
      );

      await ctx.reply(
        `🚫 <b>Federation Ban</b>\n\n` +
        `├ <b>Target:</b> ${target.first_name} (<code>${target.id}</code>)\n` +
        `└ <b>Reason:</b> ${reason}`,
        { parse_mode: 'HTML' }
      );

      // 3. Log the action
      await sendLog(ctx, `🚫 <b>FBan Action</b>\n├ Fed: <code>${fedId}</code>\n├ Target: ${target.first_name}\n└ Reason: ${reason}`);

    } catch (error) {
      console.error('fban error:', error);
      await ctx.reply('❌ Failed to execute f-ban.');
    }
  });
};
