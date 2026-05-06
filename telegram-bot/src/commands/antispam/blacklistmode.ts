import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('blacklistmode', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            const validModes = ['delete', 'warn', 'mute', 'kick', 'ban'];
            if (!validModes.includes(mode)) {
                const current = ctx.session.blacklistMode || 'delete';
                return ctx.reply(`Usage: /blacklistmode <delete|warn|mute|kick|ban>\n\nCurrent mode: <b>${current}</b>`, { parse_mode: 'HTML' });
            }
            ctx.session.blacklistMode = mode as any;
            await ctx.reply(`✅ Blacklist mode set to <b>${mode}</b>. Matching messages will trigger a ${mode} action.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('blacklistmode error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
