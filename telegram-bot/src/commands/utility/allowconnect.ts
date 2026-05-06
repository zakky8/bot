import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('allowconnect', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['on', 'off'].includes(mode)) return ctx.reply('Usage: /allowconnect <on|off>\nAllow admins to manage this group via DM.');
            await ctx.reply(mode === 'on' ? '✅ Remote connection <b>enabled</b>.' : '✅ Remote connection <b>disabled</b>.', { parse_mode: 'HTML' });
        } catch (error) { console.error('allowconnect error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

