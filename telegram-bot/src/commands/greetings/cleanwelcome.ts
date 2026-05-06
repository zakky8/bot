import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('cleanwelcome', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode)) return ctx.reply('Usage: /cleanwelcome <on|off>\nWhen on, previous welcome messages are deleted when a new one is sent.');
            await ctx.reply(mode === 'on' ? '✅ Clean welcome <b>enabled</b>. Old welcome messages will be auto-deleted.' : '✅ Clean welcome <b>disabled</b>.', { parse_mode: 'HTML' });
        } catch (error) { console.error('cleanwelcome error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

