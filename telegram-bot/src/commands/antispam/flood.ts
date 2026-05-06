import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('flood', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;

            const flood = ctx.session.flood;
            const status = flood.limit > 0 ? '✅ Enabled' : '❌ Disabled';

            await ctx.reply(
                `🌊 <b>Flood Settings</b>\n\n` +
                `├ Status: ${status}\n` +
                `├ Limit: ${flood.limit || 'Not set'} messages\n` +
                `├ Time: ${flood.interval} seconds\n` +
                `└ Action: ${flood.action}\n\n` +
                `Use /setflood to change the limit.\n` +
                `Use /setfloodmode to change the action.`, 
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('flood error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
