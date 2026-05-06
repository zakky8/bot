import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('blacklist', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const bl = ctx.session.blacklist || [];
            const mode = ctx.session.blacklistMode || 'delete';
            if (bl.length === 0) return ctx.reply('📝 <b>Blacklisted Words</b>\n\nNo words currently blacklisted.\n\nUse /addblacklist to add words.\nUse /unblacklist to remove words.\nUse /blacklistmode to set action.', { parse_mode: 'HTML' });
            const list = bl.map(w => `• <code>${w}</code>`).join('\n');
            await ctx.reply(`📝 <b>Blacklisted Words (${bl.length}):</b>\n\n${list}\n\n<b>Mode:</b> ${mode}\n\nUse /unblacklist <word> to remove.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('blacklist error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
