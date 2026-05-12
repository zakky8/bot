import { NextFunction } from 'grammy';
import { BotContext, LockAction } from '../types';
import { isAdminOrOwner } from '../utils/permissions';
import { sendLog } from '../utils';

/**
 * Middleware to enforce content locks with multi-action modes.
 */
export const locksMiddleware = async (ctx: BotContext, next: NextFunction) => {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return next();

    // Admins and Approved users are immune
    if (await isAdminOrOwner(ctx)) return next();
    if (ctx.session.approvals?.includes(ctx.from.id)) return next();

    const locks = ctx.session.locks || {};
    if (Object.keys(locks).length === 0) return next();

    const msg = ctx.message;
    if (!msg) return next();

    let triggerType: string | null = null;


    // 1. Basic Media
    if (msg.photo) triggerType = 'photo';
    else if (msg.video) triggerType = 'video';
    else if (msg.video_note) triggerType = 'video_note';
    else if (msg.voice) triggerType = 'voice';
    else if (msg.audio) triggerType = 'audio';
    else if (msg.animation) triggerType = 'gif';
    else if (msg.sticker) {
        if (msg.sticker.is_animated) triggerType = 'animated_sticker';
        else if (msg.sticker.is_video) triggerType = 'video_sticker';
        else triggerType = 'sticker';
    }
    else if (msg.document) triggerType = 'document';
    else if (msg.location) triggerType = 'location';
    else if (msg.contact) triggerType = 'contact';
    else if (msg.poll) triggerType = 'poll';
    else if (msg.dice) triggerType = 'dice';
    else if (msg.game) triggerType = 'game';
    else if (msg.story) triggerType = 'story';

    // 2. Advanced/Meta Locks — only set if no media type already matched
    const entities = [...(msg.entities || []), ...(msg.caption_entities || [])];

    if (!triggerType) {
        if (msg.new_chat_members?.some(u => u.is_bot)) triggerType = 'bot';
        else if (msg.giveaway || (msg as any).giveaway_created || (msg as any).giveaway_winners) triggerType = 'giveaway';
        else if (msg.invoice || msg.successful_payment) triggerType = 'payment';
        else if (msg.via_bot) triggerType = 'inline';
        else if (msg.reply_markup) triggerType = 'keyboard';
        else if ((msg as any).forward_from || (msg as any).forward_from_chat) triggerType = 'forward';
        else if (msg.text?.includes('t.me/joinchat') || msg.text?.includes('t.me/+')) triggerType = 'invitelink';
        else if (entities.some(e => e.type === 'url' || e.type === 'text_link')) {
            // Distinguish invite links from regular URLs
            const urls: string[] = entities
                .filter(e => e.type === 'url' || e.type === 'text_link')
                .map(e => (e as any).url || msg.text?.slice(e.offset, e.offset + e.length) || '');
            triggerType = urls.some(u => u.includes('t.me/joinchat') || u.includes('t.me/+')) ? 'invitelink' : 'url';
        }
        else if (entities.some(e => e.type === 'bot_command')) triggerType = 'command';
        else if (entities.some(e => e.type === 'custom_emoji')) triggerType = 'premium_emoji';
    }


    if (triggerType && locks[triggerType]) {
        const setting = locks[triggerType];
        if (setting.mode === 'off' && !setting.delete) return next();

        // 1. Execute Deletion
        if (setting.delete) {
            try { await ctx.deleteMessage(); } catch (e) {}
        }

        // 2. Execute Action (Punishment)
        if (setting.mode !== 'off') {
            await executeLockAction(ctx, setting.mode, triggerType);
        }
        
        return; // Message handled
    }

    if (locks['all'] && locks['all'].mode !== 'off') {
        const setting = locks['all'];
        if (setting.delete) { try { await ctx.deleteMessage(); } catch (e) {} }
        await executeLockAction(ctx, setting.mode, 'global');
        return;
    }

    return next();
};

/**
 * Executes the punishment action for a lock trigger.
 */
async function executeLockAction(ctx: BotContext, action: LockAction, type: string) {
    const user = ctx.from!;
    const userId = user.id;

    try {
        switch (action) {
            case 'warn':
                // Safe initialization for old sessions
                if (!ctx.session.warnings) ctx.session.warnings = {};
                if (!ctx.session.warnings[userId]) ctx.session.warnings[userId] = [];
                
                ctx.session.warnings[userId].push({
                    by: 'Bot (Locks)',
                    reason: `Locked content: ${type}`,
                    date: Date.now()
                });
                
                const warnCount = ctx.session.warnings[userId].length;
                const warnLimit = ctx.session.warnLimit ?? 3;
                await ctx.reply(`⚠️ <b>${user.first_name}</b>, sending <b>${type}</b> is restricted in this chat.\n└ <b>Warning:</b> ${warnCount}/${warnLimit}`, { parse_mode: 'HTML' });

                if (warnCount >= warnLimit) {
                    try {
                        await ctx.banChatMember(userId);
                        await ctx.reply(`🚫 <b>${user.first_name}</b> has been banned (Reached 3 warnings).`, { parse_mode: 'HTML' });
                    } catch (e) {
                        await ctx.reply(`❌ I tried to ban <b>${user.first_name}</b> for reaching 3 warnings, but I don't have the required admin rights!`, { parse_mode: 'HTML' });
                    }
                }
                break;

            case 'mute':
                try {
                    await ctx.restrictChatMember(userId, { can_send_messages: false });
                    await ctx.reply(`🔊 <b>${user.first_name}</b> has been muted for sending restricted content: <b>${type}</b>`, { parse_mode: 'HTML' });
                } catch (e) {
                    await ctx.reply(`❌ I tried to mute <b>${user.first_name}</b> for sending <b>${type}</b>, but I don't have the required admin rights!`, { parse_mode: 'HTML' });
                }
                break;

            case 'kick':
                try {
                    await ctx.banChatMember(userId);
                    await ctx.unbanChatMember(userId); // Kick = Ban + Unban
                    await ctx.reply(`❗ <b>${user.first_name}</b> has been kicked for sending restricted content: <b>${type}</b>`, { parse_mode: 'HTML' });
                } catch (e) {
                    await ctx.reply(`❌ I tried to kick <b>${user.first_name}</b> for sending <b>${type}</b>, but I don't have the required admin rights!`, { parse_mode: 'HTML' });
                }
                break;

            case 'ban':
                try {
                    await ctx.banChatMember(userId);
                    await ctx.reply(`🚫 <b>${user.first_name}</b> has been banned for sending restricted content: <b>${type}</b>`, { parse_mode: 'HTML' });
                } catch (e) {
                    await ctx.reply(`❌ I tried to ban <b>${user.first_name}</b> for sending <b>${type}</b>, but I don't have the required admin rights!`, { parse_mode: 'HTML' });
                }
                break;
        }

        await sendLog(ctx, `🛡️ <b>Lock Enforcement</b>\n├ User: ${user.first_name}\n├ Trigger: <code>${type}</code>\n└ Action: <b>${action}</b>`);

    } catch (e: any) {
        console.error('Lock Action Error:', e);
        // Fallback message so we know it reached the catch block!
        await ctx.reply(`❌ Lock Action Error: ${e.message}`);
    }
}
