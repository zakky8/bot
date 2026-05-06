import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('mute', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('This command can only be used in groups.');

            if (!(await isAdminOrOwner(ctx))) {
                return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' });
            }

            const reply = ctx.message?.reply_to_message;
            let targetId: number | undefined;
            let targetName: string | undefined;

            const text = ctx.message?.text || '';
            const args = text.split(/\s+/).slice(1);
            let durationArg = args[0] || '';

            if (reply) {
                targetId = reply.from?.id;
                targetName = reply.from?.first_name || 'Unknown';
            } else if (args.length > 0) {
                const resolved = await resolveUser(ctx, args[0]);
                if (resolved) {
                    targetId = resolved.id;
                    targetName = resolved.name;
                    durationArg = args[1] || '';
                } else {
                    return ctx.reply(`❌ Could not find a user with the identifier ${args[0]}.`);
                }
            }

            if (!targetId) return ctx.reply('❌ Reply to a message or provide a username/ID to mute that user.');

            const admins = await ctx.getChatAdministrators();
            const targetAdmin = admins.find(a => a.user.id === targetId);
            if (targetAdmin) return ctx.reply('❌ Cannot mute an admin.');

            // Parse duration: /mute 1h, /mute 30m, /mute 1d
            let duration = 3600; // Default 1 hour
            if (durationArg) {
                const match = durationArg.match(/^(\d+)([mhd])$/);
                if (match) {
                    const val = parseInt(match[1]);
                    const unit = match[2];
                    duration = unit === 'm' ? val * 60 : unit === 'h' ? val * 3600 : val * 86400;
                }
            }

            const untilDate = Math.floor(Date.now() / 1000) + duration;
            await ctx.restrictChatMember(targetId, {
                can_send_messages: false,
                can_send_audios: false,
                can_send_documents: false,
                can_send_photos: false,
                can_send_videos: false,
                can_send_video_notes: false,
                can_send_voice_notes: false,
                can_send_polls: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false
            }, { until_date: untilDate });

            const durationStr = duration < 3600 ? `${duration / 60}m` : duration < 86400 ? `${duration / 3600}h` : `${duration / 86400}d`;
            await ctx.reply(
                `🔇 <b>User Muted</b>\n` +
                `├ <b>User:</b> ${targetName}\n` +
                `├ <b>Duration:</b> ${durationStr}\n` +
                `└ <b>By:</b> ${ctx.from?.first_name}`,
                { parse_mode: 'HTML' }
            );
        } catch (error: any) {
            console.error('mute error:', error);
            if (error.description?.includes('not enough rights')) {
                await ctx.reply('❌ <b>Error:</b> I do not have enough permissions to mute members.', { parse_mode: 'HTML' });
            } else if (error.description?.includes('user is an administrator')) {
                await ctx.reply('❌ <b>Error:</b> I cannot mute an administrator.');
            } else {
                await ctx.reply(`❌ Failed to mute the user: ${error.message || 'Unknown error'}`);
            }
        }
    });
};
