import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('rules', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const rules = ctx.session.rules;
            if (rules) {
                await ctx.reply(`📜 <b>Group Rules</b>\n\n${rules}`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply('📜 <b>Group Rules</b>\n\nNo rules set yet.\n\nAdmins can use /setrules to set rules.', { parse_mode: 'HTML' });
            }
        } catch (error) { console.error('rules error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
