import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('demote', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            const caller = admins.find(a => a.user.id === ctx.from?.id);
            if (!caller || caller.status !== 'creator') return ctx.reply('❌ <b>Access Denied:</b> Only the group owner can use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to an admin to demote them.');

            await ctx.promoteChatMember(reply.from.id, {
                can_delete_messages: false, can_restrict_members: false,
                can_invite_users: false, can_pin_messages: false,
                can_manage_video_chats: false, can_change_info: false,
                can_promote_members: false,
            });
            await ctx.reply(`⬇️ <b>${reply.from.first_name}</b> has been demoted.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('demote error:', error); await ctx.reply('❌ Failed to demote user.'); }
    });
};
