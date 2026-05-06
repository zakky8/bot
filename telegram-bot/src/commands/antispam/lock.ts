import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('lock', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some((a) => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const type = args[0]?.toLowerCase();

            const lockTypes: Record<string, { [key: string]: boolean }> = {
                all: { can_send_messages: false },
                media: { can_send_media_messages: false },
                stickers: { can_send_other_messages: false },
                polls: { can_send_polls: false },
                info: { can_change_info: false },
                invite: { can_invite_users: false },
                pin: { can_pin_messages: false }
            };

            if (!type || !lockTypes[type]) return ctx.reply(`Unknown lock type. Available: ${Object.keys(lockTypes).join(', ')}`);

            await ctx.api.setChatPermissions(ctx.chat.id, lockTypes[type]);

            // Persist to session
            if (!ctx.session.locks) ctx.session.locks = {};
            ctx.session.locks[type as keyof typeof ctx.session.locks] = true;

            await ctx.reply(`🔒 <b>${type}</b> has been locked.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('lock error:', error); await ctx.reply('❌ Failed to lock. Check bot permissions.'); }
    });
};

