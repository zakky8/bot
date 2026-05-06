import { NextFunction } from 'grammy';
import { BotContext } from '../types';
import { isBotAdmin } from '../utils/permissions';

export const authMiddleware = async (ctx: BotContext, next: NextFunction) => {
  // If in a private chat (DM), we must protect the AI and other private commands.
  if (ctx.chat?.type === 'private' && !isBotAdmin(ctx)) {
    
    // Check if it's a callback query for a help button
    if (ctx.callbackQuery && (ctx.callbackQuery.data?.startsWith('help_') || ctx.callbackQuery.data === 'start_help')) {
      return next(); // Allow help buttons
    }

    // Check if it's the /help command
    if (ctx.message?.text?.startsWith('/help')) {
      return next(); // Allow /help command
    }

    // Check if it's a deep-linked /start command (e.g., /start help)
    if (ctx.message?.text?.startsWith('/start help')) {
      return next(); // Allow deep-linked help start
    }

    // Otherwise, completely ignore the user to protect the AI budget
    return;
  }
  
  await next();
};
