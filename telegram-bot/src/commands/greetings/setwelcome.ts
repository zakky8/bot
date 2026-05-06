import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setwelcome', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const text = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!text) return ctx.reply('Usage: /setwelcome <message>\n\nPlaceholders:\n• {user} — User mention\n• {chatname} — Group name\n• {count} — Member count\n• {first} — First name\n• {id} — User ID');

            ctx.session.welcomeMessage = text;

            const chatTitle = !target.isConnected ? (ctx.chat as any)?.title || 'Group' : 'Group';
            const preview = text.replace('{user}', ctx.from?.first_name || 'User').replace('{chatname}', chatTitle).replace('{count}', '100').replace('{first}', ctx.from?.first_name || 'User').replace('{id}', String(ctx.from?.id || 0));
            await ctx.reply(`✅ Welcome message set!\n\n<b>Preview:</b>\n${preview}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setwelcome error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
