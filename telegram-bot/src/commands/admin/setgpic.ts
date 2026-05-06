import { Bot, InputFile } from 'grammy';
import { BotContext } from '../../types';
import axios from 'axios';

export default (bot: Bot<BotContext>) => {
    bot.command('setgpic', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) {
                return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(() => {}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {}); }, 5000); });
            }
            const reply = ctx.message?.reply_to_message;
            if (!reply?.photo) return ctx.reply('❌ Reply to a photo to set it as the group picture.');
            const photo = reply.photo[reply.photo.length - 1];
            const telegramFile = await ctx.api.getFile(photo.file_id);
            if (!telegramFile.file_path) return ctx.reply('❌ Could not retrieve file path.');
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${telegramFile.file_path}`;
            const dlRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(dlRes.data as ArrayBuffer);
            await ctx.api.setChatPhoto(ctx.chat.id, new InputFile(buffer, 'photo.jpg'));
            await ctx.reply('✅ Group photo updated!');
        } catch (error: any) {
            console.error('setgpic error:', error);
            if (error?.description?.includes('not enough rights')) {
                return ctx.reply('❌ I need the <b>Change Group Info</b> admin permission to set the group photo.', { parse_mode: 'HTML' });
            }
            await ctx.reply('❌ Failed to set group photo: ' + (error?.message || 'Unknown error'));
        }
    });
};
