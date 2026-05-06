import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { isAdminOrOwner } from '../../utils/permissions';

export default (bot: Bot<BotContext>) => {
  bot.command('joinfed', async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('❌ This command must be used in a group.');
    }

    if (!(await isAdminOrOwner(ctx))) return;

    const fedId = ctx.message?.text?.split(' ')[1];
    if (!fedId) {
      return ctx.reply('❓ Please provide the Federation ID.\nExample: <code>/joinfed a1b2c3d4</code>', { parse_mode: 'HTML' });
    }

    try {
      // 1. Check if federation exists
      const fed = await query('SELECT name FROM federations WHERE id = $1', [fedId]);
      if (fed.rowCount === 0) {
        return ctx.reply('❌ <b>Federation not found.</b> Please check the ID.', { parse_mode: 'HTML' });
      }

      // 2. Link chat to federation (Update or Insert)
      await query(
        'INSERT INTO federation_chats (federation_id, chat_id) VALUES ($1, $2) ON CONFLICT (federation_id, chat_id) DO NOTHING',
        [fedId, ctx.chat.id]
      );

      // We'll store the current federation ID in the session for fast access
      ctx.session.federations = ctx.session.federations || {};
      ctx.session.federations.current = fedId;

      await ctx.reply(
        `🤝 <b>Joined Federation!</b>\n\n` +
        `├ <b>Name:</b> ${fed.rows[0].name}\n` +
        `├ <b>ID:</b> <code>${fedId}</code>\n` +
        `└ <b>Status:</b> Connected and Protected 🛡️`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('joinfed error:', error);
      await ctx.reply('❌ Failed to join federation.');
    }
  });
};
