import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('save', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const name = args[0]?.toLowerCase();
            const content = args.slice(1).join(' ') || ctx.message?.reply_to_message?.text;
            
            if (!name || !content) return ctx.reply('Usage: /save <name> <content>\nOr reply to a message: /save <name>');
            
            if (!ctx.session.notes) ctx.session.notes = {};
            ctx.session.notes[name] = content;
            
            await ctx.reply(`✅ Note <code>${name}</code> saved!`, { parse_mode: 'HTML' });
        } catch (error) { console.error('save error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
