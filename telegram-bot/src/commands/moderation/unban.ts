import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('unban', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('This command can only be used in groups.');

            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            let targetId: number | undefined;
            let targetName: string | undefined;

            const args = ctx.message?.text?.split(/\s+/) || [];
            const cmdArgs = args.slice(1);

            if (reply?.from) {
                targetId = reply.from.id;
                targetName = reply.from.first_name || 'Unknown';
            } else if (cmdArgs.length > 0) {
                const resolved = await resolveUser(ctx, cmdArgs[0]);
                if (resolved) {
                    targetId = resolved.id;
                    targetName = resolved.name;
                } else {
                    return ctx.reply(`❌ Could not find a user with the identifier ${cmdArgs[0]}.`);
                }
            }

            if (!targetId) return ctx.reply('❌ Reply to a message or provide a username/ID to unban them.');

            await ctx.api.unbanChatMember(ctx.chat.id, targetId);

            await ctx.reply(
                `🔓 <b>User Unbanned</b>\n` +
                `├ <b>User:</b> ${targetName}\n` +
                `└ <b>By:</b> ${ctx.from?.first_name}`,
                { parse_mode: 'HTML' }
            );

            console.log(`[MOD] unban: ${targetName} (${targetId}) by ${ctx.from?.first_name} in ${ctx.chat.id}`);

        } catch (error) {
            console.error('unban error:', error);
            await ctx.reply('❌ Failed to unban the user.');
        }
    });
};
