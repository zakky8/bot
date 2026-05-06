import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { resolveGroupContext } from '../../utils/connection';

export default (bot: Bot<BotContext>) => {
    bot.command('antiraid', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });

            const arg = ctx.message?.text?.split(' ')[1]?.toLowerCase();

            if (!ctx.session.antiraid) ctx.session.antiraid = { enabled: false, recentJoins: [] };
            const raid = ctx.session.antiraid;

            if (arg === 'on') {
                raid.enabled = true;

                // Retroactively kick all tracked recent joins (NOT permanent ban)
                const tracked = raid.recentJoins || [];
                let kicked = 0;
                for (const user of tracked) {
                    try {
                        // Kick (unban immediately to avoid permanent ban)
                        await ctx.api.banChatMember(targetChatId, user.id);
                        await ctx.api.unbanChatMember(targetChatId, user.id);
                        kicked++;
                    } catch (e) { /* user may have already left */ }
                }

                raid.recentJoins = [];
                await ctx.reply(
                    `🛡️ Anti-Raid <b>ENABLED</b>\n\n` +
                    `${kicked > 0 ? `⚡ Retroactively kicked <b>${kicked}</b> recently joined user(s).\n` : ''}` +
                    `All new joins will now be automatically kicked.\n\nUse /antiraid off to disable.`,
                    { parse_mode: 'HTML' }
                );
            } else if (arg === 'off') {
                raid.enabled = false;
                await ctx.reply('🛡️ Anti-Raid <b>DISABLED</b>.\n\nNew users will be muted and tracked. Use /antiraid on to activate.', { parse_mode: 'HTML' });
            } else {
                const status = raid.enabled ? '✅ Active' : '❌ Standby (Tracking)';
                const count = (raid.recentJoins || []).length;
                await ctx.reply(
                    `🛡️ <b>Anti-Raid Status</b>\n\n` +
                    `├ Status: ${status}\n` +
                    `├ Tracked joins: <b>${count}</b>\n` +
                    `└ Action: Kick (non-permanent)\n\n` +
                    `<b>Commands:</b>\n` +
                    `• /antiraid on — Enable & kick tracked users\n` +
                    `• /antiraid off — Disable (keep tracking)\n` +
                    `• /clearraid — Clear tracked user list`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (error) { console.error('antiraid error:', error); await ctx.reply('❌ An error occurred.'); }
    });

    // /clearraid — Clear the tracked recent joins list
    bot.command('clearraid', async (ctx: BotContext) => {
        try {
            const target = await resolveGroupContext(ctx);
            if (!target) return;
            const targetChatId = target.chatId;
            const admins = await ctx.api.getChatAdministrators(targetChatId);
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(targetChatId, msg.message_id).catch(()=>{}); }, 5000); });

            if (!ctx.session.antiraid) ctx.session.antiraid = { enabled: false, recentJoins: [] };
            const count = (ctx.session.antiraid.recentJoins || []).length;
            ctx.session.antiraid.recentJoins = [];
            await ctx.reply(`✅ Cleared <b>${count}</b> tracked user(s) from the raid list.`, { parse_mode: 'HTML' });
        } catch (error) { console.error('clearraid error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
