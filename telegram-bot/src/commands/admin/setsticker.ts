import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('setsticker', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id))
                return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges.', { parse_mode: 'HTML' })
                    .then(msg => { setTimeout(() => { ctx.deleteMessage().catch(() => {}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {}); }, 5000); });

            const reply = ctx.message?.reply_to_message;
            if (!reply?.sticker?.set_name)
                return ctx.reply('❌ Reply to a sticker to set it as the group sticker set.');

            await ctx.api.setChatStickerSet(ctx.chat.id, reply.sticker.set_name);
            await ctx.reply(`✅ Group sticker set updated to: <b>${reply.sticker.set_name}</b>`, { parse_mode: 'HTML' });
        } catch (error: any) {
            console.error('setsticker error:', error);
            if (error.description?.includes('not enough rights')) {
                await ctx.reply('❌ I need the "Change Group Info" admin right to set the sticker pack.');
            } else {
                await ctx.reply('❌ Failed to set sticker pack.');
            }
        }
    });
};
