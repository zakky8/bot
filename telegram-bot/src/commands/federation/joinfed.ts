import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
  bot.command('joinfed', async (ctx) => {
    await ctx.reply(
      '⚠️ <b>Federation feature unavailable</b>\n\n' +
      'Federations require a PostgreSQL database which is not currently configured.\n' +
      'Contact the bot administrator to set up the database.',
      { parse_mode: 'HTML' }
    );
  });
};
