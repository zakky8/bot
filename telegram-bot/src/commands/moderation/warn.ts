import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('warn', async (ctx: BotContext) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
            return ctx.reply('This command can only be used in groups.');
        }
        if (!ctx.from) return;

        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) {
            return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges.', { parse_mode: 'HTML' })
                .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(() => {}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {}); }, 5000); });
        }

        const replyTo = ctx.message?.reply_to_message;
        let userToWarnId: number | undefined;
        let userToWarnName: string = 'User';
        let reason = 'No reason provided';

        const args = ctx.message?.text?.split(/\s+/) || [];
        const cmdArgs = args.slice(1);

        if (replyTo?.from) {
            userToWarnId = replyTo.from.id;
            userToWarnName = replyTo.from.first_name;
            reason = cmdArgs.join(' ') || 'No reason provided';
        } else if (cmdArgs.length > 0) {
            const resolved = await resolveUser(ctx, cmdArgs[0]);
            if (resolved) {
                userToWarnId = resolved.id;
                userToWarnName = resolved.name;
                reason = cmdArgs.slice(1).join(' ') || 'No reason provided';
            } else {
                return ctx.reply(`❌ Could not find user: ${cmdArgs[0]}`);
            }
        }

        if (!userToWarnId) return ctx.reply('❌ Reply to a user or provide a username/ID to warn them.');

        // Read configurable limit and mode from session (with defaults)
        const warnLimit = ctx.session.warnLimit ?? 3;
        const warnMode  = ctx.session.warnMode  ?? 'ban';

        try {
            await query(
                'INSERT INTO warnings (user_id, chat_id, reason, warned_by, created_at) VALUES ($1, $2, $3, $4, NOW())',
                [userToWarnId, ctx.chat.id, reason, ctx.from.id]
            );

            const result = await query(
                'SELECT COUNT(*) as count FROM warnings WHERE user_id = $1 AND chat_id = $2',
                [userToWarnId, ctx.chat.id]
            );
            const warningCount = parseInt(result.rows[0].count);

            await ctx.reply(
                `⚠️ <b>Warning issued!</b>\n\n` +
                `👤 User: <a href="tg://user?id=${userToWarnId}">${userToWarnName}</a>\n` +
                `📝 Reason: ${reason}\n` +
                `🔢 Warnings: <b>${warningCount}/${warnLimit}</b>\n` +
                `👮 Warned by: ${ctx.from.first_name}`,
                { parse_mode: 'HTML' }
            );

            // Auto-action when limit reached
            if (warningCount >= warnLimit) {
                try {
                    if (warnMode === 'ban') {
                        await ctx.banChatMember(userToWarnId);
                        await ctx.reply(`🚫 <b>${userToWarnName}</b> has been <b>banned</b> after reaching ${warnLimit} warnings.`, { parse_mode: 'HTML' });
                    } else if (warnMode === 'kick') {
                        await ctx.banChatMember(userToWarnId);
                        await ctx.unbanChatMember(userToWarnId);
                        await ctx.reply(`👢 <b>${userToWarnName}</b> has been <b>kicked</b> after reaching ${warnLimit} warnings.`, { parse_mode: 'HTML' });
                    } else if (warnMode === 'mute') {
                        await ctx.restrictChatMember(userToWarnId, { can_send_messages: false });
                        await ctx.reply(`🔇 <b>${userToWarnName}</b> has been <b>muted</b> after reaching ${warnLimit} warnings.`, { parse_mode: 'HTML' });
                    }
                    // Reset warn count after action
                    await query('DELETE FROM warnings WHERE user_id = $1 AND chat_id = $2', [userToWarnId, ctx.chat.id]);
                } catch (e: any) {
                    await ctx.reply(`❌ Could not ${warnMode} user — do I have admin rights?`);
                }
            }
        } catch (error: any) {
            console.error('Warn error:', error);
            if (error.description?.includes('user is an administrator')) {
                await ctx.reply('❌ I cannot warn an administrator.');
            } else {
                await ctx.reply(`❌ Failed to issue warning: ${error.message || 'Unknown error'}`);
            }
        }
    });
};
