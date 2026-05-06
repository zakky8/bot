import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setantiraid', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });

            return ctx.reply(
                '🛡️ <b>Anti-Raid Configuration</b>\n\n' +
                'The anti-raid system works in two modes:\n\n' +
                '<b>🔴 Standby (default):</b>\n' +
                '• New users are muted & tracked silently\n' +
                '• Use /antiraid on to kick all tracked users\n\n' +
                '<b>🟢 Active:</b>\n' +
                '• New users are instantly kicked (not banned)\n' +
                '• They can rejoin after the raid is over\n\n' +
                '<b>Commands:</b>\n' +
                '• /antiraid — View status\n' +
                '• /antiraid on — Activate & purge raiders\n' +
                '• /antiraid off — Return to standby\n' +
                '• /clearraid — Clear tracked user list',
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('setantiraid error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
