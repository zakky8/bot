import { BotContext } from '../types';

export const isAdmin = async (ctx: BotContext): Promise<boolean> => {
  if (!ctx.chat || !ctx.from) return false;

  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  } catch {
    return false;
  }
};

export const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
};

export const escapeHtml = (text: string): string => {
  return text.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

export const sendLog = async (ctx: BotContext, message: string) => {
  const logChannel = ctx.session.logChannel;
  if (!logChannel) return;

  try {
    await ctx.api.sendMessage(logChannel, `📝 <b>Log Entry</b>\n\n${message}`, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Failed to send log:', e);
  }
};

/**
 * Sends a message and deletes it after a delay.
 * Default delay is 30 seconds.
 */
export const tempReply = async (ctx: BotContext, text: string, delayMs: number = 30000, options: any = {}) => {
  try {
    const msg = await ctx.reply(text, { ...options, parse_mode: 'HTML' });
    setTimeout(() => {
      ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {});
      if (ctx.message) ctx.deleteMessage().catch(() => {});
    }, delayMs);
    return msg;
  } catch (e) {
    return ctx.reply(text, { ...options, parse_mode: 'HTML' });
  }
};

