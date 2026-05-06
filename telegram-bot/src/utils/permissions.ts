import { BotContext } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const BOT_ADMINS_FILE = path.join(__dirname, '..', '..', 'bot_admins.json');

// ── Admin Cache ─────────────────────────────────────────────────────────────
// Stores chat_id -> admin_user_ids[]
const adminCache = new Map<number, { admins: number[], expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get group admins, using cache if available.
 */
export async function getGroupAdmins(ctx: BotContext): Promise<number[]> {
  if (!ctx.chat || ctx.chat.type === 'private') return [];
  
  const now = Date.now();
  const cached = adminCache.get(ctx.chat.id);
  
  if (cached && cached.expires > now) {
    return cached.admins;
  }

  try {
    const members = await ctx.getChatAdministrators();
    const adminIds = members.map(m => m.user.id);
    adminCache.set(ctx.chat.id, { admins: adminIds, expires: now + CACHE_TTL });
    return adminIds;
  } catch (err) {
    return [];
  }
}

/**
 * Load bot admins from file.
 */
export function getBotAdmins(): string[] {
  try {
    if (!fs.existsSync(BOT_ADMINS_FILE)) return [];
    return JSON.parse(fs.readFileSync(BOT_ADMINS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

/**
 * Save bot admins to file.
 */
export function saveBotAdmins(admins: string[]): void {
  fs.writeFileSync(BOT_ADMINS_FILE, JSON.stringify(admins, null, 2));
}

/**
 * Check if the user is the true bot owner.
 */
export function isOwner(ctx: BotContext): boolean {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) return false;
  return ctx.from?.id?.toString() === ownerId;
}

/**
 * Check if the user is a Bot Admin OR the true Owner.
 */
export function isBotAdmin(ctx: BotContext): boolean {
  if (isOwner(ctx)) return true;
  const userId = ctx.from?.id?.toString();
  if (!userId) return false;
  return getBotAdmins().includes(userId);
}

/**
 * Check if the user is a group admin, bot admin, or the bot owner.
 * If in a private chat, checks if they are configuring a connected group.
 */
export async function isAdminOrOwner(ctx: BotContext): Promise<boolean> {
  if (isBotAdmin(ctx)) return true;
  if (!ctx.from) return false;

  // Handle remote DM configuration
  if (!ctx.chat || ctx.chat.type === 'private') {
    try {
      const { sessionRedis } = require('../index');
      const connectedChatId = await sessionRedis.get(`user_connection:${ctx.from.id}`);
      if (connectedChatId) {
        // Verify they are still an admin of the connected group!
        const member = await ctx.api.getChatMember(connectedChatId, ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
      }
    } catch (e) {
      // Ignore errors or non-existent connections
    }
    return false; // Not connected or not an admin
  }

  // Handle standard group chat
  const admins = await getGroupAdmins(ctx);
  return admins.includes(ctx.from.id);
}

/**
 * Reply with a permission denied message.
 */
export async function denyAccess(ctx: BotContext, ownerOnly = false): Promise<void> {
  const msg = ownerOnly
    ? '🔒 This command is restricted to the <b>bot owner</b> only.'
    : '🔒 You need to be an <b>admin</b> to use this command.';
  await ctx.reply(msg, { parse_mode: 'HTML' });
}
