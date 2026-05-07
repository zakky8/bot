import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setwarnlimit', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const limit = parseInt(args[0]);
            if (isNaN(limit) || limit < 1 || limit > 20)
                return ctx.reply('Usage: /setwarnlimit <1-20>\nSet how many warnings before auto-action.');

            ctx.session.warnLimit = limit;
            const mode = ctx.session.warnMode ?? 'ban';

            await ctx.reply(
                `✅ <b>Warn limit set to ${limit}.</b>\nUsers will be <b>${mode}ned</b> after ${limit} warnings.`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('setwarnlimit error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
