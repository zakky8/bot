import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('get', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const name = ctx.message?.text?.split(' ')[1]?.toLowerCase();
            if (!name) return ctx.reply('Usage: /get <note name>');
            
            const notes = ctx.session.notes || {};
            const content = notes[name];
            
            if (!content) return ctx.reply(`❌ Note <code>${name}</code> not found.`, { parse_mode: 'HTML' });
            await ctx.reply(content);
        } catch (error) { console.error('get error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
