import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('cleanservice', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode)) return ctx.reply('Usage: /cleanservice <on|off>\nWhen on, "user joined" and "user left" service messages are auto-deleted.');
            await ctx.reply(mode === 'on' ? '✅ Clean service messages <b>enabled</b>. Join/leave notifications will be auto-deleted.' : '✅ Clean service messages <b>disabled</b>.', { parse_mode: 'HTML' });
        } catch (error) { console.error('cleanservice error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

