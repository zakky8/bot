import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('promote', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            const caller = admins.find(a => a.user.id === ctx.from?.id);
            if (!caller || caller.status !== 'creator') return ctx.reply('❌ <b>Access Denied:</b> Only the group owner can use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to a user to promote them.');

            await ctx.promoteChatMember(reply.from.id, {
                can_delete_messages: true, can_restrict_members: true,
                can_invite_users: true, can_pin_messages: true,
                can_manage_video_chats: true, can_change_info: true,
            });
            const title = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (title) { try { await ctx.api.setChatAdministratorCustomTitle(ctx.chat.id, reply.from.id, title); } catch { /* ignore */ } }

            await ctx.reply(`⬆️ <b>${reply.from.first_name}</b> has been promoted!${title ? `\nTitle: ${title}` : ''}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('promote error:', error); await ctx.reply('❌ Failed to promote user.'); }
    });
};
