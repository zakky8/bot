import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('resetwarns', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');

            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                const msg = await ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' });
                setTimeout(() => {
                    ctx.deleteMessage().catch(() => {});
                    ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {});
                }, 5000);
                return;
            }

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to a user to reset their warnings.');

            if (!ctx.session.warnings) ctx.session.warnings = {};
            ctx.session.warnings[reply.from.id] = [];

            await ctx.reply(
                `✅ All warnings for <b>${reply.from.first_name}</b> have been cleared.`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('resetwarns error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
