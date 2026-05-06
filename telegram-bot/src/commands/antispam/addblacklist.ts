import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('addblacklist', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });
            const word = ctx.message?.text?.split(' ').slice(1).join(' ')?.toLowerCase();
            if (!word) return ctx.reply('Usage: /addblacklist <word or phrase>\nMultiple words can be added separated by commas.');
            const words = word.split(',').map(w => w.trim()).filter(w => w);
            
            if (!ctx.session.blacklist) ctx.session.blacklist = [];
            const added: string[] = [];
            for (const w of words) {
                if (!ctx.session.blacklist.includes(w)) {
                    ctx.session.blacklist.push(w);
                    added.push(w);
                }
            }
            
            if (added.length === 0) return ctx.reply('⚠️ All words are already blacklisted.');
            await ctx.reply(`✅ Added <b>${added.length}</b> word(s) to the blacklist:\n${added.map(w => `• <code>${w}</code>`).join('\n')}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('addblacklist error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
