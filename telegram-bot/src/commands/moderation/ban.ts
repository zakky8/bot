import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { sendLog } from '../../utils';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('ban', async (ctx: BotContext) => {
        if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
        if (!ctx.from) return;

        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) {
            return ctx.reply('❌ Admin privileges required.').then(msg => setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000));
        }

        const replyTo = ctx.message?.reply_to_message;
        let userToBanId: number | undefined;
        let userToBanName: string | undefined;
        let reason = 'No reason provided';

        const args = ctx.message?.text?.split(/\s+/) || [];
        const cmdArgs = args.slice(1);

        if (replyTo?.from) {
            userToBanId = replyTo.from.id;
            userToBanName = replyTo.from.first_name;
            reason = cmdArgs.join(' ') || 'No reason provided';
        } else if (cmdArgs.length > 0) {
            const resolved = await resolveUser(ctx, cmdArgs[0]);
            if (resolved) {
                userToBanId = resolved.id;
                userToBanName = resolved.name;
                reason = cmdArgs.slice(1).join(' ') || 'No reason provided';
            } else {
                return ctx.reply(`❌ Could not find a user with the identifier ${cmdArgs[0]}.`);
            }
        }

        if (!userToBanId) return ctx.reply('❌ Reply to a user or provide a username/ID to ban them.');

        try {
            await ctx.banChatMember(userToBanId);
            await ctx.reply(`🚫 <b>Banned</b> <a href="tg://user?id=${userToBanId}">${userToBanName}</a>\n└ Reason: ${reason}`, { parse_mode: 'HTML' });
            
            await sendLog(ctx, 
                `🚫 <b>Action: Ban</b>\n` +
                `├ Target: <a href="tg://user?id=${userToBanId}">${userToBanName}</a> (<code>${userToBanId}</code>)\n` +
                `├ Admin: <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>\n` +
                `└ Reason: ${reason}`
            );
        } catch (error) { await ctx.reply('❌ Failed to ban. Check permissions.'); }
    });
};
