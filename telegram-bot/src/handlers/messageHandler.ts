import { Bot } from 'grammy';
import { BotContext } from '../types';
import { createLogger } from '../core/logger';

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

        // Handle Silent Mod triggers (!ban, !mute, etc)
        if (text.startsWith('!') || text.startsWith('?')) {
            const command = text.split(' ')[0].slice(1).toLowerCase();
            const triggers = ['ban', 'mute', 'kick', 'warn', 'unban', 'unmute'];

            if (triggers.includes(command)) {
                // Manually trigger the command handler for the equivalent slash command
                // Note: We strip the ! or ? and use / instead
                ctx.message.text = `/${command}${text.slice(command.length + 1)}`;
                // We let the command system take over
                return next();
            }
        }

        return next();
    });
};
