import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../../types';

import { isBotAdmin, isAdminOrOwner } from '../../utils/permissions';

export default (bot: Bot<BotContext>) => {
    bot.command('start', async (ctx: BotContext) => {
        try {
            const name = ctx.from?.first_name || 'there';
            const isPrivate = !ctx.chat || ctx.chat.type === 'private';

            if (isPrivate) {
                const payload = ctx.match;

                if (payload && payload.startsWith('st_')) {
                    const chatId = payload.replace('st_', '');
                    try {
                        const { sessionRedis } = require('../../index');
                        const chat = await ctx.api.getChat(chatId);
                        const member = await ctx.api.getChatMember(chatId, ctx.from!.id);
                        
                        if (['creator', 'administrator'].includes(member.status)) {
                            await sessionRedis.set(`user_connection:${ctx.from!.id}`, chatId);
                            await ctx.reply(
                                `✅ **Successfully connected to ${chat.title}!**\n\n` +
                                `You requested to open the settings here. All your commands will now apply to **${chat.title}**.\n\n` +
                                `Here is the settings menu:`,
                                { parse_mode: 'Markdown' }
                            );
                            // Show the full interactive settings/help menu
                            await ctx.reply(
                                `Hey! My name is <b>Super Bot</b>. I am a group management bot!\n\n` +
                                `<i>Click a button below to find out more about each category and configure your settings!</i>`,
                                {
                                    parse_mode: 'HTML',
                                    reply_markup: buildQuickHelpKeyboard(),
                                }
                            );
                            return;
                        } else {
                            return ctx.reply('❌ You are not an administrator of that group.');
                        }
                    } catch (e) {
                        return ctx.reply('❌ Could not establish remote connection. Ensure I am an admin in the group.');
                    }
                }

                if (payload === 'help') {
                    // Instantly display the Help menu
                    return ctx.reply(
                        `Hey! My name is <b>Super Bot</b>. I am a group management bot, ` +
                        `here to help you get around and keep the order in your groups!\n\n` +
                        `<b>Helpful commands:</b>\n` +
                        `• /start — Starts me!\n` +
                        `• /help — Sends this message\n` +
                        `• /chat — Talk to the AI assistant.\n\n` +
                        `<i>Click a button below to find out more about each category!</i>`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: buildQuickHelpKeyboard(),
                        }
                    );
                }

                // Show the full admin menu
                const keyboard = new InlineKeyboard()
                    .text('📚 Help & Commands', 'start_help')
                    .row()
                    .text('🤖 AI Chat', 'start_ai')
                    .text('⚙️ Settings', 'start_settings');

                await ctx.reply(
                    `Hey <b>${name}</b>! My name is <b>${ctx.me.first_name}</b> 👋\n\n` +
                    `I am a group management bot, here to help you get around and keep the order in your groups!\n\n` +
                    `All commands can be used with the following: <code>/</code> <code>!</code>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: keyboard,
                    }
                );
            } else {
                if (!(await isAdminOrOwner(ctx))) return;

                const keyboard = new InlineKeyboard()
                    .text('⚙️ Settings', 'group_settings_prompt');
                
                await ctx.reply(
                    `Hello ${name}!\nIn order to set me up, use /settings or press the underlying button.`,
                    { reply_markup: keyboard }
                );
            }
        } catch (error) {
            console.error('start error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });

    bot.callbackQuery('group_settings_prompt', async (ctx) => {
        if (!(await isAdminOrOwner(ctx))) {
            return ctx.answerCallbackQuery({ text: 'Only admins can use this.', show_alert: true });
        }
        await ctx.answerCallbackQuery();
        
        const keyboard = new InlineKeyboard()
            .text('👥 Open here', 'open_settings_here')
            .row()
            .url('👤 Open in Private Chat', `https://t.me/${ctx.me.username}?start=st_${ctx.chat?.id}`);

        await ctx.editMessageText('Where do you want to open the settings menu?', {
            reply_markup: keyboard
        });
    });

    bot.callbackQuery('open_settings_here', async (ctx) => {
        if (!(await isAdminOrOwner(ctx))) return ctx.answerCallbackQuery('❌ Admins only.');
        await ctx.answerCallbackQuery();
        
        // Show the full interactive settings/help menu instead of just text
        await ctx.editMessageText(
            `⚙️ <b>Settings Control Panel</b>\n\n` +
            `<i>Click a button below to find out more about each category and configure your settings!</i>`, 
            { 
                parse_mode: 'HTML',
                reply_markup: buildQuickHelpKeyboard()
            }
        );
    });

    bot.callbackQuery('start_help', async (ctx) => {
        try {
            await ctx.answerCallbackQuery();
            await ctx.reply(
                `Hey! My name is <b>Super Bot</b>. I am a group management bot!\n\n` +
                `<i>Click a button below to find out more about each category!</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: buildQuickHelpKeyboard(),
                }
            );
        } catch (error) {
            console.error('start_help callback error:', error);
            await ctx.answerCallbackQuery({ text: 'Error' });
        }
    });

    bot.callbackQuery('start_ai', async (ctx) => {
        try {
            await ctx.answerCallbackQuery();
            await ctx.reply(`🤖 <b>AI Chat</b>\nUse /chat or /ask to interact with the AI assistant.`, { parse_mode: 'HTML' });
        } catch (error) {
            await ctx.answerCallbackQuery({ text: 'Error' });
        }
    });

    bot.callbackQuery('start_settings', async (ctx) => {
        try {
            await ctx.answerCallbackQuery();
            await ctx.reply(`⚙️ <b>Settings</b>\nUse /settings in a group to configure your group.`, { parse_mode: 'HTML' });
        } catch (error) {
            await ctx.answerCallbackQuery({ text: 'Error' });
        }
    });
};

function buildQuickHelpKeyboard(): InlineKeyboard {
    const kb = new InlineKeyboard();
    const buttons = [
        ['Admin', 'Antiflood', 'AntiRaid'],
        ['Bans', 'Blocklists', 'CAPTCHA'],
        ['Clean Service', 'Connections', 'Federations'],
        ['Filters', 'Greetings', 'Locks'],
        ['Muting', 'Notes', 'Pin'],
        ['Purges', 'Reports', 'Rules'],
        ['Warnings', 'Fun', '✨ AI Chat'],
        ['Misc'],
    ];

    const keyMap: Record<string, string> = {
        'Admin': 'admin', 'Antiflood': 'antiflood', 'AntiRaid': 'antiraid',
        'Bans': 'bans', 'Blocklists': 'blacklists', 'CAPTCHA': 'captcha',
        'Clean Service': 'cleanservice', 'Connections': 'connections', 'Federations': 'federations',
        'Filters': 'filters', 'Greetings': 'greetings', 'Locks': 'locks',
        'Muting': 'muting', 'Notes': 'notes', 'Pin': 'pin',
        'Purges': 'purges', 'Reports': 'reports', 'Rules': 'rules',
        'Warnings': 'warnings', 'Fun': 'fun', '✨ AI Chat': 'aichat',
        'Misc': 'misc',
    };

    for (const row of buttons) {
        for (const label of row) {
            kb.text(label, `help_${keyMap[label]}`);
        }
        kb.row();
    }

    return kb;
}
