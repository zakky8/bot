import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../types';
import { createLogger } from '../core/logger';
import { sendLog } from '../utils';

const logger = createLogger('MemberHandler');

// ── Captcha timeout tracker ──────────────────────────────────────────────────
// key: `${chatId}:${userId}` → { timeout, msgId }
const pendingCaptchas = new Map<string, { timeout: NodeJS.Timeout; msgId?: number }>();

function captchaKey(chatId: number, userId: number) {
    return `${chatId}:${userId}`;
}

function cancelPendingCaptcha(chatId: number, userId: number) {
    const key = captchaKey(chatId, userId);
    const pending = pendingCaptchas.get(key);
    if (pending) {
        clearTimeout(pending.timeout);
        pendingCaptchas.delete(key);
    }
}
// ─────────────────────────────────────────────────────────────────────────────

/** Send and optionally auto-delete a welcome message, respecting cleanWelcome. */
async function sendWelcome(ctx: BotContext, chatId: number, member: { id: number; first_name: string }) {
    const welcomeMsg = ctx.session.welcomeMessage;
    if (!welcomeMsg) return;

    // Delete previous welcome message if cleanWelcome is on
    if (ctx.session.cleanWelcome && ctx.session.lastWelcomeMsgId) {
        await ctx.api.deleteMessage(chatId, ctx.session.lastWelcomeMsgId).catch(() => {});
        ctx.session.lastWelcomeMsgId = undefined;
    }

    let count = '?';
    try { count = String(await ctx.api.getChatMemberCount(chatId)); } catch { /* ignore */ }

    const text = welcomeMsg
        .replace(/\{user\}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
        .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
        .replace(/\{count\}/g, count)
        .replace(/\{first\}/g, member.first_name)
        .replace(/\{id\}/g, String(member.id));

    const sent = await ctx.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => null);
    if (sent && ctx.session.cleanWelcome) {
        ctx.session.lastWelcomeMsgId = sent.message_id;
    }
}

export default (bot: Bot<BotContext>) => {

    // ── PRIMARY join handler ─────────────────────────────────────────────────
    // message:new_chat_members fires for EVERY join (first-time AND rejoin),
    // making it more reliable than chat_member for captcha enforcement.
    bot.on('message:new_chat_members', async (ctx) => {
        const chatId = ctx.chat.id;

        // Always delete the "X joined the group" service message
        await ctx.deleteMessage().catch(() => {});

        for (const member of ctx.message.new_chat_members) {
            if (member.is_bot) continue;

            logger.info(`User joined: ${member.first_name} (${member.id}) in chat ${chatId}`);

            // Cancel any stale captcha (user left and rejoined before timeout)
            cancelPendingCaptcha(chatId, member.id);

            // ── Federation ban check ──────────────────────────────────────────
            const currentFedId = ctx.session.federations?.current;
            if (currentFedId) {
                try {
                    const { query } = require('../core/database');
                    const fban = await query(
                        'SELECT reason FROM federation_bans WHERE federation_id = $1 AND user_id = $2',
                        [currentFedId, member.id]
                    );
                    if ((fban.rowCount ?? 0) > 0) {
                        await ctx.api.banChatMember(chatId, member.id);
                        await ctx.api.sendMessage(chatId,
                            `🚫 <b>F-Banned User Detected</b>\n\nThis user is globally banned in this federation.\n└ <b>Reason:</b> ${fban.rows[0].reason}`,
                            { parse_mode: 'HTML' }
                        );
                        await sendLog(ctx,
                            `🛡️ <b>FBan Enforcement</b>\n├ User: ${member.first_name}\n└ Status: Banned (Federation DB)`
                        );
                        continue;
                    }
                } catch (e) { logger.error('FBan check error:', e); }
            }

            // ── Anti-Raid check ───────────────────────────────────────────────
            if (!ctx.session.antiraid) ctx.session.antiraid = { enabled: false, recentJoins: [] };
            const raid = ctx.session.antiraid;

            if (raid.enabled) {
                try {
                    await ctx.api.banChatMember(chatId, member.id);
                    await ctx.api.unbanChatMember(chatId, member.id);
                    await sendLog(ctx,
                        `🛡️ <b>Anti-Raid Action</b>\n├ User: ${member.first_name}\n└ Status: Kicked (Raid Mode Active)`
                    );
                } catch (e) { logger.warn('Anti-raid kick failed:', e); }
                continue;
            }

            // Track recent joins (for raid detection)
            raid.recentJoins.push({ id: member.id, joinedAt: Date.now() });
            raid.recentJoins = raid.recentJoins.filter(j => j.joinedAt > Date.now() - 86_400_000);

            // ── Captcha ───────────────────────────────────────────────────────
            if (ctx.session.captcha?.enabled) {
                // Restrict the user immediately — they cannot speak until verified
                try {
                    await ctx.api.restrictChatMember(chatId, member.id, { can_send_messages: false });
                } catch (e) {
                    logger.error(`Failed to restrict user ${member.id} for captcha:`, e);
                    // Can't restrict — send welcome anyway (bot may lack permission)
                    await sendWelcome(ctx, chatId, member);
                    continue;
                }

                const mode = ctx.session.captcha.mode || 'button';
                let question = 'Please verify you are human to join the chat.';
                let keyboard = new InlineKeyboard();

                if (mode === 'math') {
                    const a = Math.floor(Math.random() * 9) + 1;
                    const b = Math.floor(Math.random() * 9) + 1;
                    const sum = a + b;
                    question = `🔢 <b>Quick math check</b>\n\nWhat is <code>${a} + ${b}</code>?`;
                    const distractors = new Set<number>();
                    distractors.add(sum);
                    while (distractors.size < 4) {
                        distractors.add(sum + Math.floor(Math.random() * 5) - 2);
                    }
                    [...distractors].sort(() => Math.random() - 0.5).forEach(ans => {
                        keyboard.text(String(ans), `captcha_verify_${member.id}_${ans === sum ? 'correct' : 'wrong'}`);
                    });
                } else {
                    keyboard.text('✅ I am not a bot', `captcha_verify_${member.id}_correct`);
                }

                const captchaText = ctx.session.captcha.text
                    || `👋 Welcome, <a href="tg://user?id=${member.id}">${member.first_name}</a>!\n\n${question}`;

                const sent = await ctx.api.sendMessage(chatId, captchaText, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard,
                }).catch((e) => { logger.error('Failed to send captcha message:', e); return null; });

                // ── Captcha timeout / auto-kick ───────────────────────────────
                const kickMinutes = ctx.session.captcha.kickTime ?? 5;
                const msgId = sent?.message_id;

                const timeout = setTimeout(async () => {
                    pendingCaptchas.delete(captchaKey(chatId, member.id));
                    logger.info(`Captcha timeout for user ${member.id} in chat ${chatId} — kicking`);
                    try {
                        await ctx.api.banChatMember(chatId, member.id);
                        await ctx.api.unbanChatMember(chatId, member.id); // ban+unban = kick
                        await sendLog(ctx,
                            `⏰ <b>Captcha Timeout</b>\n├ User: <a href="tg://user?id=${member.id}">${member.first_name}</a>\n└ Kicked after ${kickMinutes}m without verifying`
                        );
                    } catch (e) { logger.warn('Captcha kick failed:', e); }
                    if (msgId) await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
                }, kickMinutes * 60 * 1000);

                pendingCaptchas.set(captchaKey(chatId, member.id), { timeout, msgId });

            } else {
                // ── No captcha — send welcome directly ────────────────────────
                await sendWelcome(ctx, chatId, member);
            }
        }
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── PRIMARY leave handler ────────────────────────────────────────────────
    bot.on('message:left_chat_member', async (ctx) => {
        const chatId = ctx.chat.id;
        const member = ctx.message.left_chat_member;

        // Always delete the "X left the group" service message
        await ctx.deleteMessage().catch(() => {});

        if (member.is_bot) return;

        logger.info(`User left: ${member.first_name} (${member.id}) from chat ${chatId}`);

        // Cancel pending captcha if they leave before verifying
        cancelPendingCaptcha(chatId, member.id);

        const goodbyeMsg = ctx.session.goodbyeMessage;
        if (goodbyeMsg) {
            const text = goodbyeMsg
                .replace(/\{user\}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
                .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
                .replace(/\{first\}/g, member.first_name)
                .replace(/\{id\}/g, String(member.id));
            const sent = await ctx.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => null);
            // Delete goodbye message instantly to keep chat clean
            if (sent) await ctx.api.deleteMessage(chatId, sent.message_id).catch(() => {});
        }
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── chat_member: logging only ─────────────────────────────────────────────
    // Captcha + welcome are handled in message:new_chat_members above.
    // chat_member is kept solely for structured join/leave logs.
    bot.on('chat_member', async (ctx) => {
        const oldStatus = ctx.chatMember.old_chat_member.status;
        const newStatus = ctx.chatMember.new_chat_member.status;
        const member    = ctx.chatMember.new_chat_member.user;
        const chatId    = ctx.chat.id;

        if (member.is_bot) return;

        const isJoin = (oldStatus === 'left' || oldStatus === 'kicked') &&
                       (newStatus === 'member' || newStatus === 'restricted');

        if (isJoin) {
            await sendLog(ctx,
                `👤 <b>New Member Joined</b>\n` +
                `├ User: <a href="tg://user?id=${member.id}">${member.first_name}</a>\n` +
                `└ ID: <code>${member.id}</code>`
            );
        }

        const isLeave = (oldStatus === 'member' || oldStatus === 'restricted' || oldStatus === 'administrator') &&
                        (newStatus === 'left' || newStatus === 'kicked');

        if (isLeave) {
            await sendLog(ctx,
                `👋 <b>Member Left</b>\n` +
                `├ User: <a href="tg://user?id=${member.id}">${member.first_name}</a>\n` +
                `└ ID: <code>${member.id}</code>`
            );
        }
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── Captcha callback query handler ────────────────────────────────────────
    bot.callbackQuery(/^captcha_verify_(\d+)_(correct|wrong)$/, async (ctx) => {
        const userId  = parseInt(ctx.match[1], 10);
        const result  = ctx.match[2];
        const chatId  = ctx.chat?.id;

        if (!chatId) return ctx.answerCallbackQuery();

        // Only the correct user can answer their own captcha
        if (ctx.from.id !== userId) {
            return ctx.answerCallbackQuery({ text: '❌ This captcha is not for you!', show_alert: true });
        }

        if (result === 'wrong') {
            return ctx.answerCallbackQuery({ text: '❌ Wrong answer! Try again.', show_alert: true });
        }

        // ── Correct answer ────────────────────────────────────────────────────
        cancelPendingCaptcha(chatId, userId);

        try {
            // Fully restore all default permissions
            await ctx.api.restrictChatMember(chatId, userId, {
                can_send_messages:         true,
                can_send_audios:           true,
                can_send_documents:        true,
                can_send_photos:           true,
                can_send_videos:           true,
                can_send_video_notes:      true,
                can_send_voice_notes:      true,
                can_send_polls:            true,
                can_send_other_messages:   true,
                can_add_web_page_previews: true,
            });

            await ctx.answerCallbackQuery({ text: '✅ Verified! Welcome to the group.' });

            // Delete the captcha message
            if (ctx.msg?.message_id) {
                await ctx.api.deleteMessage(chatId, ctx.msg.message_id).catch(() => {});
            }

            // Send welcome message after successful verification
            await sendWelcome(ctx, chatId, { id: userId, first_name: ctx.from.first_name });

            await sendLog(ctx,
                `✅ <b>Captcha Passed</b>\n├ User: <a href="tg://user?id=${userId}">${ctx.from.first_name}</a>\n└ ID: <code>${userId}</code>`
            );
        } catch (error) {
            logger.error('CAPTCHA verification error:', error);
            await ctx.answerCallbackQuery({ text: '⚠️ An error occurred. Please contact an admin.', show_alert: true });
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
};
