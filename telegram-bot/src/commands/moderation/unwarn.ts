import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('unwarn', async (ctx: BotContext) => {
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
            let targetId: number | undefined;
            let targetName = 'User';

            const args = ctx.message?.text?.split(/\s+/) || [];
            const cmdArgs = args.slice(1);

            if (reply?.from) {
                targetId = reply.from.id;
                targetName = reply.from.first_name;
            } else if (cmdArgs.length > 0) {
                const resolved = await resolveUser(ctx, cmdArgs[0]);
                if (resolved) {
                    targetId = resolved.id;
                    targetName = resolved.name;
                } else {
                    return ctx.reply(`❌ Could not find user: ${cmdArgs[0]}`);
                }
            }

            if (!targetId) return ctx.reply('❌ Reply to a user or provide a username/ID to remove their last warning.');

            if (!ctx.session.warnings) ctx.session.warnings = {};
            const userWarns = ctx.session.warnings[targetId] ?? [];

            if (userWarns.length === 0) {
                return ctx.reply(`✅ <b>${targetName}</b> has no warnings.`, { parse_mode: 'HTML' });
            }

            // Remove the most recent warning
            ctx.session.warnings[targetId] = userWarns.slice(0, -1);
            const remaining = ctx.session.warnings[targetId].length;
            const warnLimit = ctx.session.warnLimit ?? 3;

            await ctx.reply(
                `✅ Removed last warning from <b>${targetName}</b>.\n└ Remaining: <b>${remaining}/${warnLimit}</b>`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('unwarn error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
