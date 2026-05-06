import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setrules', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const rules = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!rules) return ctx.reply('Usage: /setrules <rules text>');
            ctx.session.rules = rules;
            await ctx.reply(`✅ Rules updated!\n\n📜 <b>Preview:</b>\n${rules}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setrules error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
