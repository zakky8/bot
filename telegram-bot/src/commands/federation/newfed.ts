import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { v4 as uuidv4 } from 'uuid';

export default (bot: Bot<BotContext>) => {
  bot.command('newfed', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ This command can only be used in private chat.');
    }

    const fedName = ctx.message?.text?.split(' ').slice(1).join(' ');
    if (!fedName) {
      return ctx.reply('❓ Please provide a name for your federation.\nExample: <code>/newfed My Network</code>', { parse_mode: 'HTML' });
    }

    const fedId = uuidv4().slice(0, 8);
    const ownerId = ctx.from!.id;

    try {
      await query(
        'INSERT INTO federations (id, name, owner_id) VALUES ($1, $2, $3)',
        [fedId, fedName, ownerId]
      );
      
      // Also add owner as admin
      await query(
        'INSERT INTO federation_admins (federation_id, user_id) VALUES ($1, $2)',
        [fedId, ownerId]
      );

      await ctx.reply(
        `✅ <b>Federation Created!</b>\n\n` +
        `├ <b>Name:</b> ${fedName}\n` +
        `└ <b>ID:</b> <code>${fedId}</code>\n\n` +
        `Use <code>/joinfed ${fedId}</code> in your groups to connect them.`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('newfed error:', error);
      await ctx.reply('❌ Failed to create federation. You might already have one with this name.');
    }
  });
};
