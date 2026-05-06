import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isOwner, getBotAdmins, saveBotAdmins } from '../../utils/permissions';
import { createLogger } from '../../core/logger';

const logger = createLogger('BotAdminsCommand');

export default (bot: Bot<BotContext>) => {
    // ── /addbotadmin [userId] ───────────────────────────────────────────────
    bot.command('addbotadmin', async (ctx: BotContext) => {
        try {
            if (!isOwner(ctx)) {
                return ctx.reply('❌ <b>Access Denied:</b> Only the true bot owner can use this command.', { parse_mode: 'HTML' });
            }

            const reply = ctx.message?.reply_to_message;
            let targetId: string | undefined;
            let targetName: string | undefined;

            if (reply && reply.from) {
                targetId = reply.from.id.toString();
                targetName = reply.from.first_name;
            } else {
                const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
                if (args[0] && /^\d+$/.test(args[0])) {
                    targetId = args[0];
                    targetName = `User ${targetId}`;
                }
            }

            if (!targetId) {
                return ctx.reply('❌ Reply to a user or provide their User ID to add them as a Bot Admin.');
            }

            const admins = getBotAdmins();
            if (admins.includes(targetId)) {
                return ctx.reply(`User <b>${targetName}</b> (<code>${targetId}</code>) is already a Bot Admin.`, { parse_mode: 'HTML' });
            }

            admins.push(targetId);
            saveBotAdmins(admins);

            logger.info(`Owner ${ctx.from?.id} added ${targetId} as Bot Admin`);
            await ctx.reply(`✅ <b>Bot Admin Added</b>\n\nUser <b>${targetName}</b> (<code>${targetId}</code>) has been granted Bot Admin permissions. They can now manage the bot settings across all groups.`, { parse_mode: 'HTML' });
        } catch (error) {
            logger.error('addbotadmin error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });

    // ── /delbotadmin [userId] ───────────────────────────────────────────────
    bot.command('delbotadmin', async (ctx: BotContext) => {
        try {
            if (!isOwner(ctx)) {
                return ctx.reply('❌ <b>Access Denied:</b> Only the true bot owner can use this command.', { parse_mode: 'HTML' });
            }

            const reply = ctx.message?.reply_to_message;
            let targetId: string | undefined;
            let targetName: string | undefined;

            if (reply && reply.from) {
                targetId = reply.from.id.toString();
                targetName = reply.from.first_name;
            } else {
                const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
                if (args[0] && /^\d+$/.test(args[0])) {
                    targetId = args[0];
                    targetName = `User ${targetId}`;
                }
            }

            if (!targetId) {
                return ctx.reply('❌ Reply to a user or provide their User ID to remove them from Bot Admins.');
            }

            let admins = getBotAdmins();
            if (!admins.includes(targetId)) {
                return ctx.reply(`User <code>${targetId}</code> is not a Bot Admin.`, { parse_mode: 'HTML' });
            }

            admins = admins.filter(id => id !== targetId);
            saveBotAdmins(admins);

            logger.info(`Owner ${ctx.from?.id} removed ${targetId} from Bot Admins`);
            await ctx.reply(`⛔️ <b>Bot Admin Removed</b>\n\nUser <b>${targetName}</b> (<code>${targetId}</code>) has been removed from Bot Admins.`, { parse_mode: 'HTML' });
        } catch (error) {
            logger.error('delbotadmin error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });

    // ── /botadmins ──────────────────────────────────────────────────────────
    bot.command('botadmins', async (ctx: BotContext) => {
        try {
            if (!isOwner(ctx)) {
                return ctx.reply('❌ <b>Access Denied:</b> Only the true bot owner can use this command.', { parse_mode: 'HTML' });
            }

            const admins = getBotAdmins();
            if (admins.length === 0) {
                return ctx.reply('ℹ️ There are currently no dynamic Bot Admins configured. Only the Owner has access.', { parse_mode: 'HTML' });
            }

            const list = admins.map(id => `• <code>${id}</code>`).join('\n');
            await ctx.reply(`👑 <b>Dynamic Bot Admins</b>\n\n${list}`, { parse_mode: 'HTML' });
        } catch (error) {
            logger.error('botadmins error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });
};
