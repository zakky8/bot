import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';

const categories: Record<string, { emoji: string; title: string; text: string }> = {
// ... (rest of categories remain the same)
  admin: {
    emoji: '👑', title: 'Admin',
    text: '👑 <b>Admin</b>\n\nSome groups need more control over who has admin powers and what they can do. This module lets you manage promotions, demotions, and group metadata easily.\n\n<b>Admin commands:</b>\n- /promote: Promote a user to admin.\n- /demote: Remove admin from a user.\n- /title: Set a custom admin title.\n- /setgtitle: Set the group title.\n- /setgpic: Set the group photo.\n- /setdesc: Set the group description.\n- /setsticker: Set the group sticker pack.\n- /delsticker: Remove the group sticker pack.\n- /invitelink: Generate a new invite link.\n- /setlog: Set a log channel for admin actions.\n- /unsetlog: Remove the log channel.\n\n<b>Examples:</b>\n- Promote a user by reply:\n→ <code>/promote</code>',
  },
  antiflood: {
    emoji: '🌊', title: 'Antiflood',
    text: '🌊 <b>Antiflood</b>\n\nSome people just love to spam messages, ruining conversations for everyone. The antiflood module automatically detects and punishes users who send too many messages in a short time.\n\n<b>Admin commands:</b>\n- /flood: View current flood settings.\n- /setflood &lt;number&gt;: Set the flood message threshold. Use 0 or off to disable.\n- /setfloodmode &lt;action&gt;: Set action when flood is triggered. Actions: ban, kick, mute, tban, tmute.\n\n<b>Examples:</b>\n- Set flood limit to 10 messages:\n→ <code>/setflood 10</code>\n- Mute flooders instead of banning:\n→ <code>/setfloodmode mute</code>',
  },
  antiraid: {
    emoji: '🛡', title: 'AntiRaid',
    text: '🛡 <b>AntiRaid</b>\n\nWhen your group gets raided by a wave of new accounts joining at once, antiraid mode helps you lock things down instantly.\n\n<b>Admin commands:</b>\n- /antiraid: Toggle anti-raid mode on/off.\n- /setantiraid &lt;threshold&gt; &lt;action&gt;: Configure how many joins trigger raid mode and what action to take.\n\n<b>Examples:</b>\n- Enable anti-raid that kicks after 10 joins/minute:\n→ <code>/setantiraid 10 kick</code>',
  },
  bans: {
    emoji: '🔨', title: 'Bans',
    text: '🔨 <b>Bans</b>\n\nSome people need to be publicly banned; spammers, annoyances, or just trolls.\n\nThis module allows you to do that easily, by exposing some common actions, so everyone will see!\n\n<b>Admin commands:</b>\n- /ban: Ban a user.\n- /unban: Unban a user.\n- /kick: Kick a user.\n- /mute: Mute a user.\n- /unmute: Unmute a user.\n\n<b>Examples:</b>\n- Ban a user by replying to their message:\n→ Reply with <code>/ban</code>\n- Ban a user by username:\n→ <code>/ban @username</code>',
  },
  blacklists: {
    emoji: '🚫', title: 'Blocklists',
    text: '🚫 <b>Blocklists</b>\n\nWant to stop certain words from being used in your group? The blocklist module lets you add triggers that automatically take action when someone sends a blocked word or phrase.\n\n<b>Admin commands:</b>\n- /addblacklist &lt;trigger&gt;: Add a word/phrase to the blacklist.\n- /unblacklist &lt;trigger&gt;: Remove a word from the blacklist.\n- /blacklist: View current blacklisted words.\n- /blacklistmode &lt;action&gt;: Set action on match (delete/warn/mute/kick/ban).\n\n<b>Examples:</b>\n- Blocklist the word "spam":\n→ <code>/addblacklist spam</code>\n- Kick users who trigger blocklist:\n→ <code>/blacklistmode kick</code>',
  },
  captcha: {
    emoji: '🤖', title: 'CAPTCHA',
    text: '🤖 <b>CAPTCHA</b>\n\nBots and automated accounts often join groups to spam. CAPTCHA verification ensures that every new member is a real human before they can participate.\n\n<b>Admin commands:</b>\n- /captchamode &lt;on/off&gt;: Enable or disable CAPTCHA on join.\n- /setcaptcha &lt;type&gt;: Set CAPTCHA type (button/math/text).\n- /captchatext &lt;text&gt;: Set custom CAPTCHA message text.\n- /captchakick &lt;time&gt;: Auto-kick users who fail CAPTCHA after time.\n\n<b>Examples:</b>\n- Enable math CAPTCHA:\n→ <code>/setcaptcha math</code>\n- Kick unverified users after 5 minutes:\n→ <code>/captchakick 5m</code>',
  },
  cleanservice: {
    emoji: '🧹', title: 'Clean Service',
    text: '🧹 <b>Clean Service</b>\n\nService messages like "User joined" or "User left" can clutter your chat. This module lets you automatically delete them to keep things tidy.\n\n<b>Admin commands:</b>\n- /cleanwelcome &lt;on/off&gt;: Auto-delete old welcome messages.\n- /cleanservice &lt;on/off&gt;: Delete service messages (user joined/left).',
  },
  connections: {
    emoji: '🔗', title: 'Connections',
    text: '🔗 <b>Connections</b>\n\nSometimes you want to manage a group from private chat rather than posting commands publicly. Connections let you link your PM to a group.\n\n<b>User commands:</b>\n- /connect &lt;chatid&gt;: Connect your PM to a group.\n- /disconnect: Disconnect from the group.\n- /connection: Show your active connection.\n\n<b>Admin commands:</b>\n- /allowconnect &lt;on/off&gt;: Allow or deny connections to this group.',
  },
  federations: {
    emoji: '🌐', title: 'Federations',
    text: '🌐 <b>Federations</b>\n\nManaging multiple groups? Federations let you ban a user across all your groups at once, keeping your entire network clean.\n\n<b>Admin commands:</b>\n- /newfed &lt;name&gt;: Create a new federation.\n- /delfed &lt;id&gt;: Delete a federation.\n- /joinfed &lt;id&gt;: Join a federation.\n- /leavefed: Leave the current federation.\n- /fban &lt;user&gt;: Ban across all federated groups.\n- /unfban &lt;user&gt;: Remove a federation ban.\n- /fedinfo: Get info about a federation.\n- /fedadmins: List federation admins.\n- /fedpromote: Promote a fed admin.\n- /feddemote: Demote a fed admin.\n- /fedbanlist: View banned users.\n- /myfeds: List your federations.\n- /frename: Rename a federation.\n- /fednotif: Toggle notifications.\n- /chatfed: Show this chat\'s federation.',
  },
  filters: {
    emoji: '🗂', title: 'Filters',
    text: '🗂 <b>Filters</b>\n\nMake your group interactive! Filters let the bot auto-reply when someone sends a message containing a specific keyword or phrase.\n\n<b>Admin commands:</b>\n- /filter &lt;keyword&gt; &lt;reply&gt;: Set a filter.\n- /stop &lt;keyword&gt;: Remove a filter.\n- /stopall: Remove all filters.\n- /filters: List all active filters.\n\n<b>Examples:</b>\n- Auto-reply when someone says "rules":\n→ <code>/filter rules Please read the pinned message!</code>',
  },
  greetings: {
    emoji: '👋', title: 'Greetings',
    text: '👋 <b>Greetings</b>\n\nGive your members a warm welcome or a proper goodbye! Customize what the bot says when someone joins or leaves your group.\n\n<b>Admin commands:</b>\n- /welcome: Preview the welcome message.\n- /setwelcome &lt;text&gt;: Set a custom welcome message.\n- /resetwelcome: Reset to default.\n- /goodbye: Preview the goodbye message.\n- /setgoodbye &lt;text&gt;: Set a custom goodbye.\n- /resetgoodbye: Reset to default.\n- /welcomemute: Mute new members until CAPTCHA.\n- /welcomemutehelp: Show mute instructions.\n\n<b>Formatting:</b>\nUse {first}, {last}, {fullname}, {username}, {id}, {chatname} as placeholders.',
  },
  locks: {
    emoji: '🔒', title: 'Locks',
    text: '🔒 <b>Locks</b>\n\nWant to restrict certain types of messages? The lock module lets you block specific media types, links, forwards, and more.\n\n<b>Admin commands:</b>\n- /lock &lt;type&gt;: Lock a message type.\n- /unlock &lt;type&gt;: Unlock a message type.\n- /locks: View all active locks.\n- /locktypes: List all lockable types.\n\n<b>Lockable types:</b>\nall, media, stickers, gifs, links, polls, invite, forwards, photos, videos, audio, voice, documents, games',
  },
  muting: {
    emoji: '🔇', title: 'Muting',
    text: '🔇 <b>Muting</b>\n\nSometimes a user needs a timeout rather than a full ban. Muting restricts a user from sending any messages in the group.\n\n<b>Admin commands:</b>\n- /mute: Mute a user.\n- /unmute: Unmute a user.\n- /slowmode &lt;seconds&gt;: Set a cooldown between messages.\n\n<b>Examples:</b>\n- Mute a user by reply:\n→ Reply with <code>/mute</code>\n- Set 30-second slowmode:\n→ <code>/slowmode 30</code>',
  },
  notes: {
    emoji: '📝', title: 'Notes',
    text: '📝 <b>Notes</b>\n\nSave important information that members can retrieve anytime. Perfect for FAQs, links, and rules that people ask about repeatedly.\n\n<b>Admin commands:</b>\n- /save &lt;name&gt; &lt;text&gt;: Save a new note.\n- /clear &lt;name&gt;: Delete a note.\n- /clearall: Delete all notes.\n\n<b>User commands:</b>\n- /get &lt;name&gt;: Retrieve a saved note.\n- /notes: List all saved notes.\n\n<b>Examples:</b>\n- Save a rules note:\n→ <code>/save rules No spam, be respectful!</code>\n- Retrieve it:\n→ <code>/get rules</code>',
  },
  pin: {
    emoji: '📌', title: 'Pin',
    text: '📌 <b>Pin</b>\n\nKeep important messages visible by pinning them to the top of the chat. Everyone in the group can see pinned messages easily.\n\n<b>Admin commands:</b>\n- /pin: Pin the replied-to message.\n- /unpin: Unpin a message.\n- /unpinall: Unpin all messages.\n- /pinned: Show the current pinned message.',
  },
  purges: {
    emoji: '🗑', title: 'Purges',
    text: '🗑 <b>Purges</b>\n\nNeed to clean up a conversation quickly? Purge lets you bulk-delete messages in a channel instantly.\n\n<b>Admin commands:</b>\n- /purge: Delete all messages from the replied message to the latest.\n- /spurge: Silent purge — deletes without sending a confirmation.\n- /purgefrom &lt;msg_id&gt;: Delete messages starting from a specific message ID.\n\n<b>Examples:</b>\n- Purge from a specific message:\n→ Reply to the start message with <code>/purge</code>',
  },
  reports: {
    emoji: '📢', title: 'Reports',
    text: '📢 <b>Reports</b>\n\nAllow users to report troublemakers to the admins directly. When someone reports a user, all admins are instantly notified.\n\n<b>User commands:</b>\n- /report: Report a user by replying to their message.\n\n<b>User commands:</b>\n- /adminlist: List all current group admins.',
  },
  rules: {
    emoji: '📜', title: 'Rules',
    text: '📜 <b>Rules</b>\n\nEvery group needs rules. Set them once and let members check them anytime with a simple command.\n\n<b>Admin commands:</b>\n- /setrules &lt;text&gt;: Set the group rules.\n- /clearrules: Remove the group rules.\n- /privaterules &lt;on/off&gt;: Send rules in private chat.\n\n<b>User commands:</b>\n- /rules: Show the group rules.\n\n<b>Examples:</b>\n- Set rules:\n→ <code>/setrules 1. No spam 2. Be respectful 3. English only</code>',
  },
  warnings: {
    emoji: '⚠️', title: 'Warnings',
    text: '⚠️ <b>Warnings</b>\n\nKeep track of rule-breakers with a warning system. After reaching the warn limit, automatic action is taken — ban, kick, or mute.\n\n<b>Admin commands:</b>\n- /warn: Issue a warning to a user.\n- /unwarn: Remove a user\'s last warning.\n- /resetwarns: Reset all warnings for a user.\n- /setwarnlimit &lt;num&gt;: Set max warnings before auto-action.\n- /setwarnmode &lt;action&gt;: Set action on limit (ban/kick/mute).\n\n<b>User commands:</b>\n- /warns: View your warning count.\n\n<b>Examples:</b>\n- Set 3-warning limit with ban:\n→ <code>/setwarnlimit 3</code>\n→ <code>/setwarnmode ban</code>',
  },
  fun: {
    emoji: '🎮', title: 'Fun',
    text: '🎮 <b>Fun</b>\n\nLighten the mood! These interactive commands let members engage with each other in a fun way.\n\n<b>User commands:</b>\n- /hug: Send a hug to a user.\n- /pat: Pat a user on the head.\n- /slap: Slap a user playfully.\n- /roll: Roll a dice (1-6).\n- /runs: Run away!',
  },
  aichat: {
    emoji: '🤖', title: '✨ AI Chat',
    text: '🤖 <b>AI Chat</b>\n\nPowered by Anthropic Claude — an intelligent assistant that answers questions from the community FAQ knowledge base. If it can\'t answer, it automatically escalates to a human moderator.\n\n<b>User commands:</b>\n- /chat &lt;message&gt;: Ask the AI anything.\n- /chat clear: Reset your conversation history.\n- /ask &lt;question&gt;: Alias for /chat.\n- /support &lt;issue&gt;: Escalate directly to a human moderator.\n\n<b>Admin commands:</b>\n- /aisetup key &lt;key&gt;: Set the Anthropic API key.\n- /aisetup model &lt;model&gt;: Switch AI model.\n- /aisetup status: Show AI configuration.\n- /aisetup test: Test AI connectivity.\n- /aisetup faq: Reload FAQ data.\n\n<b>Examples:</b>\n- Ask a question:\n→ <code>/chat How do I reset my password?</code>',
  },
  misc: {
    emoji: '🔧', title: 'Misc',
    text: '🔧 <b>Misc</b>\n\nGeneral utility commands that don\'t fit into other categories but are useful for everyday bot interaction.\n\n<b>User commands:</b>\n- /start: Start the bot.\n- /help: Show the help menu.\n- /info: Get detailed info about a user.\n- /id: Show Telegram ID for user/chat.\n- /ping: Check bot response latency.\n- /stats: Show bot and chat statistics.\n\n<b>Admin commands:</b>\n- /settings: Open group settings panel.\n- /zombies: Detect and remove deleted accounts.',
  },
};

function buildHelpKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  const keys = Object.keys(categories);

  // Layout: 3 buttons per row
  for (let i = 0; i < keys.length; i++) {
    const cat = categories[keys[i]];
    kb.text(cat.title, `help_${keys[i]}`);
    if ((i + 1) % 3 === 0) kb.row();
  }

  kb.row().text('🗑 Close', 'help_close');
  return kb;
}

const HELP_TEXT =
  `Hey! My name is <b>Super Bot</b>. I am a group management bot, ` +
  `here to help you get around and keep the order in your groups!\n\n` +
  `I have lots of handy features, such as flood control, a warning system, ` +
  `a note keeping system, AI-powered FAQ support, and even predetermined replies on certain keywords.\n\n` +
  `<b>Helpful commands:</b>\n` +
  `• /start — Starts me! You've probably already used this.\n` +
  `• /help — Sends this message; I'll tell you more about myself!\n` +
  `• /chat — Talk to the AI assistant.\n\n` +
  `<i>Click a button below to find out more about each category!</i>`;

export default (bot: Bot<BotContext>) => {

    bot.command('help', async (ctx: BotContext) => {
        try {
            const isPrivate = !ctx.chat || ctx.chat.type === 'private';
            const isAdmin = await isAdminOrOwner(ctx);

            if (!isPrivate && !isAdmin) {
                // Regular user in a group (Rose style)
                const keyboard = new InlineKeyboard()
                    .url('Help me!', `https://t.me/${bot.botInfo.username}?start=help`);
                return ctx.reply('Contact me in PM to get help.', { reply_markup: keyboard });
            }

            // Private chat OR Admin in a group
            await ctx.reply(HELP_TEXT, {
                parse_mode: 'HTML',
                reply_markup: buildHelpKeyboard(),
            });
        } catch (error) {
            console.error('help error:', error);
            await ctx.reply('❌ An error occurred.');
        }
    });

    bot.callbackQuery('help_close', async (ctx) => {
        try {
            await ctx.deleteMessage().catch(() => {});
            await ctx.answerCallbackQuery();
        } catch (e) { }
    });

  bot.callbackQuery('help_back', async (ctx) => {
    try {
      await ctx.editMessageText(HELP_TEXT, {
        parse_mode: 'HTML',
        reply_markup: buildHelpKeyboard(),
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error('help back error:', error);
      await ctx.answerCallbackQuery({ text: 'Error returning to menu' });
    }
  });

  bot.callbackQuery(/^help_(.+)$/, async (ctx) => {
    try {
      const key = ctx.match![1];
      const cat = categories[key];

      if (!cat) {
        await ctx.answerCallbackQuery({ text: 'Unknown category' });
        return;
      }

      // Build a "⬅️ Back" button to return to the main help menu
      const backKb = new InlineKeyboard().text('⬅️ Back', 'help_back');

      await ctx.editMessageText(cat.text, {
        parse_mode: 'HTML',
        reply_markup: backKb,
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error('help callback error:', error);
      await ctx.answerCallbackQuery({ text: 'Error loading category' });
    }
  });
};
