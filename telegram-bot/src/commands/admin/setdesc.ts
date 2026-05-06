import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setdesc', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const desc = ctx.message?.text?.split(' ').slice(1).join(' ');
            if (!desc) return ctx.reply('Usage: /setdesc <description>');
            await ctx.api.setChatDescription(ctx.chat.id, desc.substring(0, 255));
            await ctx.reply('✅ Group description updated!');
        } catch (error) { console.error('setdesc error:', error); await ctx.reply('❌ Failed to set description.'); }
    });
};

