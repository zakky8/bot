import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('notes', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const notes = ctx.session.notes || {};
            const keys = Object.keys(notes);
            if (keys.length === 0) return ctx.reply('📝 No notes saved. Use /save <name> <content> to create one.');
            const list = keys.map(n => `• <code>${n}</code>`).join('\n');
            await ctx.reply(`📝 <b>Saved Notes (${keys.length}):</b>\n\n${list}\n\nUse /get <name> to retrieve a note.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('notes error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
