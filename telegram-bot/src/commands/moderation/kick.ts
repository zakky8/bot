import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('kick', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') {
                return ctx.reply('This command can only be used in groups.');
            }

            const admins = await ctx.getChatAdministrators();
            const isAdmin = admins.some(a => a.user.id === ctx.from?.id);
            if (!isAdmin) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            let targetId: number | undefined;
            let targetName: string | undefined;
            let reason = 'No reason provided';

            const args = ctx.message?.text?.split(/\s+/) || [];
            const cmdArgs = args.slice(1);

            if (reply) {
                targetId = reply.from?.id;
                targetName = reply.from?.first_name || 'Unknown';
                reason = cmdArgs.join(' ') || 'No reason provided';
            } else if (cmdArgs.length > 0) {
                const resolved = await resolveUser(ctx, cmdArgs[0]);
                if (resolved) {
                    targetId = resolved.id;
                    targetName = resolved.name;
                    reason = cmdArgs.slice(1).join(' ') || 'No reason provided';
                } else {
                    return ctx.reply(`❌ Could not find a user with the identifier ${cmdArgs[0]}.`);
                }
            }

            if (!targetId) return ctx.reply('❌ Reply to a message or provide a username/ID to kick that user.');

            const botMember = admins.find(a => a.user.id === ctx.me.id);
            if (!botMember) return ctx.reply('❌ I need admin permissions to kick users.');

            const targetAdmin = admins.find(a => a.user.id === targetId);
            if (targetAdmin) return ctx.reply('❌ Cannot kick an admin.');

            await ctx.banChatMember(targetId);
            await ctx.unbanChatMember(targetId); // Unban immediately = kick

            await ctx.reply(
                `👢 <b>User Kicked</b>\n` +
                `├ <b>User:</b> ${targetName}\n` +
                `├ <b>By:</b> ${ctx.from?.first_name}\n` +
                `└ <b>Reason:</b> ${reason}`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('kick error:', error);
            await ctx.reply('❌ Failed to kick the user. Check bot permissions.');
        }
    });
};
