import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('setwarnmode', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const admins = await ctx.api.getChatAdministrators(target.chatId);
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ Admins only.');

            const args = ctx.message?.text?.split(' ').slice(1) || [];
            const mode = args[0]?.toLowerCase() as 'ban' | 'kick' | 'mute';
            if (!['ban', 'kick', 'mute'].includes(mode))
                return ctx.reply('Usage: /setwarnmode <ban|kick|mute>');

            ctx.session.warnMode = mode;
            const limit = ctx.session.warnLimit ?? 3;

            const emojis: Record<string, string> = { ban: '🔨', kick: '👢', mute: '🔇' };
            await ctx.reply(
                `${emojis[mode]} <b>Warn mode set to ${mode}.</b>\nUsers will be ${mode}${mode === 'mute' ? 'd' : mode === 'ban' ? 'ned' : 'ed'} after ${limit} warnings.`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('setwarnmode error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
