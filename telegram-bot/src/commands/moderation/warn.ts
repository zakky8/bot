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
            return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
        }

        const replyTo = ctx.message?.reply_to_message;
        let userToWarnId: number | undefined;
        let userToWarnName: string | undefined;
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
                return ctx.reply(`❌ Could not find a user with the identifier ${cmdArgs[0]}.`);
            }
        }

        if (!userToWarnId) return ctx.reply('❌ Reply to a user or provide a username/ID to warn them.');

        try {
            // Add warning to database
            await query(
                'INSERT INTO warnings (user_id, chat_id, reason, warned_by, created_at) VALUES ($1, $2, $3, $4, NOW())',
                [userToWarnId, ctx.chat.id, reason, ctx.from.id]
            );

            // Get warning count
            const result = await query(
                'SELECT COUNT(*) as count FROM warnings WHERE user_id = $1 AND chat_id = $2',
                [userToWarnId, ctx.chat.id]
            );

            const warningCount = parseInt(result.rows[0].count);

            await ctx.reply(
                `⚠️ Warning issued!\n\n` +
                `👤 User: ${userToWarnName}\n` +
                `📝 Reason: ${reason}\n` +
                `🔢 Total warnings: ${warningCount}/3\n` +
                `👮 Warned by: ${ctx.from.first_name}`
            );

            // Auto-ban at 3 warnings
            if (warningCount >= 3) {
                await ctx.banChatMember(userToWarnId);
                await ctx.reply(`🚫 User banned after reaching 3 warnings!`);
            }
        } catch (error: any) {
            console.error('Warn error:', error);
            if (error.description?.includes('user is an administrator')) {
                await ctx.reply('❌ <b>Error:</b> I cannot warn an administrator.');
            } else {
                await ctx.reply(`❌ Failed to issue warning: ${error.message || 'Unknown error'}`);
            }
        }
    });
};
