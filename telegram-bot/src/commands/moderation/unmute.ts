import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';
import { createLogger } from '../../core/logger';
import { resolveUser } from '../../utils/user';

const logger = createLogger('UnmuteCommand');

export default (bot: Bot<BotContext>) => {
    bot.command('unmute', async (ctx: BotContext) => {
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        logger.info(`Unmute command triggered by ${userId} in chat ${chatId}`);

        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('This command can only be used in groups.');
            
            if (!(await isAdminOrOwner(ctx))) {
                logger.warn(`User ${userId} attempted to unmute without permissions.`);
                return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' });
            }

            const reply = ctx.message?.reply_to_message;
            let targetId: number | undefined;
            let targetName: string | undefined;

            if (reply) {
                if (reply.from) {
                    targetId = reply.from.id;
                    targetName = reply.from.first_name;
                } else if (reply.sender_chat) {
                    targetId = reply.sender_chat.id;
                    targetName = reply.sender_chat.title;
                }
            } else {
                const text = ctx.message?.text || '';
                const args = text.split(/\s+/).slice(1);
                if (args[0]) {
                    const resolved = await resolveUser(ctx, args[0]);
                    if (resolved) {
                        targetId = resolved.id;
                        targetName = resolved.name;
                    } else {
                        return ctx.reply(`❌ Could not find a user with the identifier ${args[0]}. Note: I can only resolve usernames of users who have interacted with me before.`);
                    }
                }
            }

            if (!targetId) {
                logger.info('No target user identified for unmute.');
                return ctx.reply('❌ Reply to a message or provide a User ID to unmute.');
            }

            logger.info(`Attempting to unmute target ${targetId} (${targetName})`);

            await ctx.restrictChatMember(targetId, {
                can_send_messages: true,
                can_send_audios: true,
                can_send_documents: true,
                can_send_photos: true,
                can_send_videos: true,
                can_send_video_notes: true,
                can_send_voice_notes: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_change_info: false,
                can_invite_users: true,
                can_pin_messages: false
            });

            logger.info(`Successfully unmuted target ${targetId}`);
            await ctx.reply(`🔊 <b>${targetName}</b> has been unmuted by <b>${ctx.from?.first_name}</b>.`, { parse_mode: 'HTML' });
        } catch (error: any) {
            logger.error('unmute error:', error);
            if (error.description?.includes('not enough rights')) {
                await ctx.reply('❌ <b>Error:</b> I do not have enough permissions to unmute members. I need "Restrict Members" permission.', { parse_mode: 'HTML' });
            } else if (error.description?.includes('user is an administrator')) {
                await ctx.reply('❌ Cannot unmute an administrator.');
            } else {
                await ctx.reply(`❌ Failed to unmute the user: ${error.message || 'Unknown error'}`);
            }
        }
    });
};
