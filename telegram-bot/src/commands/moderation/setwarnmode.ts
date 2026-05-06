import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setwarnmode', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase();
            if (!['ban', 'kick', 'mute'].includes(mode)) return ctx.reply('Usage: /setwarnmode <ban|kick|mute>');
            const emojis: Record<string, string> = { ban: '🔨', kick: '👢', mute: '🔇' };
            await ctx.reply(`${emojis[mode]} Warn mode set to <b>${mode}</b>. Users exceeding the warn limit will be ${mode}${mode === 'mute' ? 'd' : mode === 'ban' ? 'ned' : 'ed'}.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('setwarnmode error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

