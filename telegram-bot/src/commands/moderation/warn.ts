import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('warn', async (ctx: BotContext) => {
        if (!ctx.chat || ctx.chat.type === 'private') {
            return ctx.reply('This command can only be used in groups.');
        }
        if (!ctx.from) return;

        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) {
            const msg = await ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges.', { parse_mode: 'HTML' });
            setTimeout(() => {
                ctx.deleteMessage().catch(() => {});
                ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {});
            }, 5000);
            return;
        }

        const replyTo = ctx.message?.reply_to_message;
        let userToWarnId: number | undefined;
        let userToWarnName = 'User';
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

        if (!userToWarnId) {
            return ctx.reply('❌ Reply to a user or provide a username/ID to warn them.');
        }

        // Check if target is admin — can't warn admins
        try {
            const targetMember = await ctx.getChatMember(userToWarnId);
            if (['creator', 'administrator'].includes(targetMember.status)) {
                return ctx.reply('❌ I cannot warn an administrator.');
            }
        } catch { /* user might have left — proceed */ }

        const warnLimit = ctx.session.warnLimit ?? 3;
        const warnMode  = ctx.session.warnMode  ?? 'ban';

        // Store warning in session
        if (!ctx.session.warnings) ctx.session.warnings = {};
        if (!ctx.session.warnings[userToWarnId]) ctx.session.warnings[userToWarnId] = [];

        ctx.session.warnings[userToWarnId].push({
            by: ctx.from.first_name,
            reason,
            date: Date.now(),
        });

        const warningCount = ctx.session.warnings[userToWarnId].length;

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
                ctx.session.warnings[userToWarnId] = [];
            } catch {
                await ctx.reply(`❌ Could not ${warnMode} user — do I have the required admin rights?`);
            }
        }
    });
};
