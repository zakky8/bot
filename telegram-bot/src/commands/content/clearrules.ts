import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('clearrules', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            ctx.session.rules = undefined;
            await ctx.reply('✅ <b>Rules cleared.</b>', { parse_mode: 'HTML' });
        } catch (error) {
            console.error('clearrules error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
