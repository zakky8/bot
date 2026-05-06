import { Bot } from 'grammy';
import { BotContext } from '../../types';

export default (bot: Bot<BotContext>) => {
    bot.command('settings', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
            await ctx.reply(
                `⚙️ <b>Group Settings</b>\n\n` +
                `├ Welcome: ✅ Enabled\n├ Goodbye: ✅ Enabled\n├ Anti-Flood: ❌ Disabled\n` +
                `├ Anti-Raid: ❌ Disabled\n├ CAPTCHA: ❌ Disabled\n├ Blacklist: 0 words\n` +
                `├ Filters: 0 active\n├ Notes: 0 saved\n├ Rules: Not set\n` +
                `├ Log Channel: Not set\n└ Federation: None\n\n` +
                `Use the respective commands to configure each feature.`,
                { parse_mode: 'HTML' }
            );
        } catch (error) { console.error('settings error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};

