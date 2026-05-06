import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('title', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('❌ This command can only be used in groups. Use /connect to link a group first.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id && a.status === 'creator')) return ctx.reply('❌ <b>Access Denied:</b> Only the group owner can use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const reply = ctx.message?.reply_to_message;
            if (!reply?.from) return ctx.reply('❌ Reply to an admin to set their title.');
            const title = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!title) return ctx.reply('Usage: /title <custom title>');
            await ctx.api.setChatAdministratorCustomTitle(ctx.chat.id, reply.from.id, title.substring(0, 16));
            await ctx.reply(`🏷️ Title for <b>${reply.from.first_name}</b> set to: <b>${title.substring(0, 16)}</b>`, { parse_mode: 'HTML' });
        } catch (error) { console.error('title error:', error); await ctx.reply('❌ Failed to set title.'); }
    });
};
