import { Bot } from 'grammy';
import { BotContext } from '../types';
import { createLogger } from '../core/logger';
import { isAdminOrOwner } from '../utils/permissions';

const logger = createLogger('MessageEngine');

export default (bot: Bot<BotContext>) => {
    bot.on('message', async (ctx, next) => {
        // This handler now only manages 'post-middleware' logic or generic message tasks
        // Most security is handled in /middlewares/

        const text = ctx.message?.text || ctx.message?.caption;
        if (!text) return next();

        // Handle Hashtag Note triggers (#noteName)
        if (text.startsWith('#')) {
            const noteName = text.split(/\s+/)[0].slice(1).toLowerCase();
            const notes = ctx.session.notes || {};
            if (notes[noteName]) {
                return ctx.reply(notes[noteName]);
            }
        }

        // Handle Silent Mod triggers (!ban, !mute, etc) — admins/owners only
        if (text.startsWith('!') || text.startsWith('?')) {
            const command = text.split(' ')[0].slice(1).toLowerCase();
            const triggers = ['ban', 'mute', 'kick', 'warn', 'unban', 'unmute'];

            if (triggers.includes(command)) {
                // Only admins/owners may use silent triggers
                if (!(await isAdminOrOwner(ctx))) return next();
                // Rewrite as slash command so the registered handler runs
                ctx.message.text = `/${command}${text.slice(command.length + 1)}`;
                return next();
            }
        }

        return next();
    });
};
