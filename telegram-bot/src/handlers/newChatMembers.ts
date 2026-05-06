import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../types';
import { createLogger } from '../core/logger';
import { sendLog } from '../utils';

const logger = createLogger('MemberHandler');

export default (bot: Bot<BotContext>) => {
    bot.on('chat_member', async (ctx) => {
        const oldStatus = ctx.chatMember.old_chat_member.status;
        const newStatus = ctx.chatMember.new_chat_member.status;
        const member = ctx.chatMember.new_chat_member.user;

        if ((oldStatus === 'left' || oldStatus === 'kicked') && (newStatus === 'member' || newStatus === 'restricted')) {
            if (member.is_bot) return;

            logger.info(`User joined: ${member.first_name} (${member.id})`);
            await sendLog(ctx, `👤 <b>New Member Joined</b>\n├ User: <a href="tg://user?id=${member.id}">${member.first_name}</a>\n└ ID: <code>${member.id}</code>`);

            const currentFedId = ctx.session.federations?.current;
            if (currentFedId) {
                const { query } = require('../core/database');
                try {
                    const fban = await query(
                        'SELECT reason FROM federation_bans WHERE federation_id = $1 AND user_id = $2',
                        [currentFedId, member.id]
                    );
                    if (fban.rowCount > 0) {
                        await ctx.banChatMember(member.id);
                        await ctx.reply(`🚫 <b>F-Banned User Detected</b>\n\nThis user is globally banned in this federation.\n└ <b>Reason:</b> ${fban.rows[0].reason}`, { parse_mode: 'HTML' });
                        await sendLog(ctx, `🛡️ <b>FBan Enforcement</b>\n├ User: ${member.first_name}\n└ Status: Banned (Found in Federation DB)`);
                        return; // Stop processing further
                    }
                } catch (e) { logger.error('FBan check error:', e); }
            }

            // Anti-Raid tracking
            if (!ctx.session.antiraid) ctx.session.antiraid = { enabled: false, recentJoins: [] };
            const raid = ctx.session.antiraid;

            if (raid.enabled) {
                try {
                    await ctx.banChatMember(member.id);
                    await ctx.unbanChatMember(member.id);
                    await sendLog(ctx, `🛡️ <b>Anti-Raid Action</b>\n├ User: ${member.first_name}\n└ Status: Kicked (Raid Mode Active)`);
                } catch (e) {}
                return;
            }

            raid.recentJoins.push({ id: member.id, joinedAt: Date.now() });
            const dayAgo = Date.now() - 86400000;
            raid.recentJoins = raid.recentJoins.filter(j => j.joinedAt > dayAgo);

            // CAPTCHA or Welcome
            if (ctx.session.captcha?.enabled) {
                try {
                    await ctx.restrictChatMember(member.id, { can_send_messages: false });
                    const mode = ctx.session.captcha.mode || 'button';
                    let question = 'Please verify you are human.';
                    let keyboard = new InlineKeyboard();

                    if (mode === 'math') {
                        const a = Math.floor(Math.random() * 9) + 1;
                        const b = Math.floor(Math.random() * 9) + 1;
                        const sum = a + b;
                        question = `🔢 <b>Math Quiz</b>\n\nWhat is <code>${a} + ${b}</code>?`;
                        const answers = [sum, sum + 1, sum - 1, sum + 2].sort(() => Math.random() - 0.5);
                        answers.forEach(ans => {
                            keyboard.text(String(ans), `captcha_verify_${member.id}_${ans === sum ? 'correct' : 'wrong'}`);
                        });
                    } else {
                        keyboard.text('✅ I am human', `captcha_verify_${member.id}_correct`);
                    }

                    await ctx.reply(`Welcome <a href="tg://user?id=${member.id}">${member.first_name}</a>!\n\n${question}`, {
                        parse_mode: 'HTML',
                        reply_markup: keyboard,
                    });
                } catch (e) {}
            } else {
                const welcomeMsg = ctx.session.welcomeMessage;
                if (welcomeMsg) {
                    let count = '?'; try { count = String(await ctx.getChatMemberCount()); } catch (e) {}
                    const text = welcomeMsg
                        .replace(/\{user\}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
                        .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
                        .replace(/\{count\}/g, count)
                        .replace(/\{first\}/g, member.first_name)
                        .replace(/\{id\}/g, String(member.id));
                    await ctx.reply(text, { parse_mode: 'HTML' });
                }
            }
        }

        if ((oldStatus === 'member' || oldStatus === 'restricted' || oldStatus === 'administrator') && (newStatus === 'left' || newStatus === 'kicked')) {
            if (member.is_bot) return;

            logger.info(`User left: ${member.first_name} (${member.id})`);
            await sendLog(ctx, `👋 <b>Member Left</b>\n├ User: <a href="tg://user?id=${member.id}">${member.first_name}</a>\n└ ID: <code>${member.id}</code>`);

            const goodbyeMsg = ctx.session.goodbyeMessage;
            if (goodbyeMsg) {
                const text = goodbyeMsg
                    .replace(/\{user\}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
                    .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
                    .replace(/\{first\}/g, member.first_name)
                    .replace(/\{id\}/g, String(member.id));
                await ctx.reply(text, { parse_mode: 'HTML' }).catch(() => {});
            }
        }
    });

    bot.callbackQuery(/captcha_verify_(\d+)_(correct|wrong)/, async (ctx) => {
        const userId = parseInt(ctx.match[1], 10);
        const result = ctx.match[2];

        if (ctx.from.id !== userId) return ctx.answerCallbackQuery({ text: '❌ Not for you!', show_alert: true });

        if (result === 'wrong') {
            return ctx.answerCallbackQuery({ text: '❌ Wrong answer! Try again or wait for timeout.', show_alert: true });
        }

        try {
            await ctx.restrictChatMember(userId, {
                can_send_messages: true, can_send_audios: true, can_send_documents: true,
                can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
                can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
                can_add_web_page_previews: true,
            });
            await ctx.answerCallbackQuery({ text: '✅ Verified!' });
            if (ctx.msg) await ctx.api.deleteMessage(ctx.chat?.id as number, ctx.msg.message_id);
            
            // Dispatch welcome message AFTER captcha success
            const welcomeMsg = ctx.session.welcomeMessage;
            if (welcomeMsg) {
                let count = '?'; try { count = String(await ctx.getChatMemberCount()); } catch (e) {}
                const text = welcomeMsg
                    .replace(/\{user\}/g, `<a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>`)
                    .replace(/\{chatname\}/g, ctx.chat?.title || 'Group')
                    .replace(/\{count\}/g, count)
                    .replace(/\{first\}/g, ctx.from.first_name)
                    .replace(/\{id\}/g, String(ctx.from.id));
                await ctx.reply(text, { parse_mode: 'HTML' });
            }
        } catch (error) { logger.error('CAPTCHA error:', error); }
    });
};
