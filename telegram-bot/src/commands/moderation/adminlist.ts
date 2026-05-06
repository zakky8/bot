import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('adminlist', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            const list = admins.map(a => {
                const title = 'custom_title' in a && a.custom_title ? ` — ${a.custom_title}` : '';
                const status = a.status === 'creator' ? '👑' : '⭐';
                return `${status} <a href="tg://user?id=${a.user.id}">${a.user.first_name}</a>${title}`;
            }).join('\n');
            const chatTitle = !target.isConnected ? (ctx.chat as any)?.title || 'this chat' : 'connected group';
            await ctx.reply(`👥 <b>Admins in ${chatTitle}:</b>\n\n${list}\n\n<b>Total:</b> ${admins.length}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('adminlist error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
