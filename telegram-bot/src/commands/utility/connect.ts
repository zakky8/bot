import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { sessionRedis } from '../../index';

export default (bot: Bot<BotContext>) => {
    bot.command('connect', async (ctx) => {
        if (ctx.chat?.type !== 'private') {
            return ctx.reply('❌ This command can only be used in private messages with me.');
        }

        const args = ctx.message?.text?.split(' ').slice(1);
        if (!args || args.length === 0) {
            return ctx.reply('⚠️ Please provide a group username or ID.\nExample: `/connect @mygroup`', { parse_mode: 'Markdown' });
        }

        const target = args[0];
        try {
            // Get chat info to verify it exists and the bot is in it
            const chat = await ctx.api.getChat(target);
            
            if (chat.type === 'private') {
                return ctx.reply('❌ You can only connect to groups or supergroups.');
            }

            // Verify the user is an admin or creator in the target chat
            const member = await ctx.api.getChatMember(chat.id, ctx.from!.id);
            if (!['creator', 'administrator'].includes(member.status)) {
                return ctx.reply(`❌ You must be an administrator in **${chat.title}** to connect to it.`, { parse_mode: 'Markdown' });
            }

            // Save connection to Redis
            await sessionRedis.set(`user_connection:${ctx.from!.id}`, chat.id);

            await ctx.reply(
                `✅ **Successfully connected to ${chat.title}!**\n\n` +
                `All configuration commands (like \`/locks\`, \`/rules\`, \`/settings\`) you send me here in PM will now seamlessly apply to **${chat.title}** without interrupting the group chat.\n\n` +
                `When you are finished, use \`/disconnect\`.`,
                { parse_mode: 'Markdown' }
            );

        } catch (e: any) {
            if (e.message.includes('chat not found')) {
                await ctx.reply('❌ Could not find that group. Make sure I am a member of it and the username/ID is correct.');
            } else if (e.message.includes('user not found')) {
                await ctx.reply('❌ You do not appear to be in that group.');
            } else {
                await ctx.reply('❌ An error occurred while trying to connect. Are you sure I am an admin in that group?');
                console.error('Connect error:', e);
            }
        }
    });

    bot.command('disconnect', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;

        const connection = await sessionRedis.get(`user_connection:${ctx.from!.id}`);
        if (!connection) {
            return ctx.reply('⚠️ You are not currently connected to any group.');
        }

        await sessionRedis.del(`user_connection:${ctx.from!.id}`);
        await ctx.reply('✅ **Disconnected.**\n\nYour commands will no longer be routed to the remote group.', { parse_mode: 'Markdown' });
    });

    bot.command('connection', async (ctx) => {
        if (ctx.chat?.type !== 'private') return;

        const connectedChatId = await sessionRedis.get(`user_connection:${ctx.from!.id}`);
        if (!connectedChatId) {
            return ctx.reply('ℹ️ You are not currently connected to any group.\nUse `/connect <group>` to connect.', { parse_mode: 'Markdown' });
        }

        try {
            const chat = await ctx.api.getChat(connectedChatId);
            await ctx.reply(`🔌 You are currently connected to **${chat.title || 'a group'}**.\nAll configuration commands will apply there.`, { parse_mode: 'Markdown' });
        } catch (e) {
            // Group might have been deleted or bot removed
            await sessionRedis.del(`user_connection:${ctx.from!.id}`);
            await ctx.reply('ℹ️ Your previous connection is no longer valid and has been removed.');
        }
    });
};
