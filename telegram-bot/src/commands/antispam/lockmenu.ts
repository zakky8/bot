import { Bot, InlineKeyboard } from 'grammy';
import { BotContext, LockAction } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';

const LOCK_ICONS: Record<string, { icon: string; label: string }> = {
    story:           { icon: '📱', label: 'Story' },
    photo:           { icon: '📸', label: 'Photo' },
    video:           { icon: '🎞️', label: 'Video' },
    album:           { icon: '🖼️', label: 'Album' },
    gif:             { icon: '🎥', label: 'GIF' },
    voice:           { icon: '🎤', label: 'Voice' },
    audio:           { icon: '🎧', label: 'Audio' },
    sticker:         { icon: '🃏', label: 'Sticker' },
    animated_sticker:{ icon: '🎭', label: 'Animated stickers' },
    dice:            { icon: '🎲', label: 'Animated Games' },
    animated_emoji:  { icon: '😃', label: 'Animated Emoji' },
    premium_emoji:   { icon: '👾', label: 'Premium Emoji' },
    document:        { icon: '💾', label: 'File' },
    giveaway:        { icon: '🎁', label: 'Giveaway' },
    game:            { icon: '🎮', label: 'Game' },
    contact:         { icon: '☎️', label: 'Phone' },
    poll:            { icon: '📊', label: 'Poll' },
    keyboard:        { icon: '📋', label: 'Keyboard' },
    location:        { icon: '📍', label: 'Location' },
    command:         { icon: '🆎', label: 'Command' },
    payment:         { icon: '💵', label: 'Payment' },
    bot:             { icon: '🤖', label: 'Bot' },
    inline:          { icon: '🗯️', label: 'Inline' },
    url:             { icon: '🌌', label: 'URL' },
    forward:         { icon: '👁️‍🗨️', label: 'Forward' }
};

const ACTION_ICONS: Record<LockAction | 'delete', string> = {
    off:   '✔️',
    warn:  '!',
    kick:  '❗',
    mute:  '🔊',
    ban:   '🚫',
    delete: '🗑️'
};

export default (bot: Bot<BotContext>) => {
    bot.command('locktypes', async (ctx) => {
        if (!(await isAdminOrOwner(ctx))) return;

        // Delete the command message to keep the chat clean
        try { await ctx.deleteMessage(); } catch (e) {}

        await ctx.reply(
            getLockSummaryText(ctx.session.locks || {}),
            {
                parse_mode: 'HTML',
                reply_markup: createLockKeyboard(ctx)
            }
        );
    });

    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('lk:')) return next();
        
        if (!(await isAdminOrOwner(ctx))) {
            return ctx.answerCallbackQuery('❌ Admins only.');
        }

        const parts = data.split(':');
        
        // Handle Pagination
        if (parts[1] === 'page') {
            const newPage = parseInt(parts[2], 10);
            try {
                await ctx.answerCallbackQuery();
                await ctx.editMessageText(getLockSummaryText(ctx.session.locks || {}), {
                    parse_mode: 'HTML',
                    reply_markup: createLockKeyboard(ctx, newPage)
                });
            } catch (e) {
                console.error('Lockmenu pagination error:', e);
            }
            return;
        }

        // Handle Close/Done Button
        if (parts[1] === 'close') {
            try {
                await ctx.answerCallbackQuery('Settings saved!');
                await ctx.deleteMessage();
            } catch (e) {
                console.error('Lockmenu close error:', e);
            }
            return;
        }

        const type = parts[1];
        const action = parts[2] as LockAction | 'delete';

        const locks = ctx.session.locks || {};
        const current = locks[type] || { mode: 'off', delete: false };

        if (action === 'delete') {
            current.delete = !current.delete;
        } else {
            current.mode = (current.mode === action ? 'off' : action) as LockAction;
            // If turning on a punishment, auto-enable deletion
            if (current.mode !== 'off') current.delete = true;
        }

        ctx.session.locks[type] = current;
        
        try {
            await ctx.answerCallbackQuery(`Updated ${type}`);
            
            // Reconstruct the keyboard on the current page to avoid jumping back to page 1
            const keys = Object.keys(LOCK_ICONS);
            const itemIndex = keys.indexOf(type);
            const currentPage = Math.floor(itemIndex / 13);

            await ctx.editMessageText(getLockSummaryText(ctx.session.locks), {
                parse_mode: 'HTML',
                reply_markup: createLockKeyboard(ctx, currentPage)
            });
        } catch (e) {
            console.error('Lockmenu update error:', e);
        }
    });
};

export function getLockSummaryText(locks: Record<string, LockSetting>): string {
    let text = `📸 <b>Media Block</b>\n\n` +
               `! = Warn | ❗ = Kick\n` +
               `🔊 = Mute | 🚫 = Ban\n` +
               `🗑️ = Deletion\n` +
               `✔️ = Off\n` +
               `────────────────────\n-\n\n`;

    Object.entries(LOCK_ICONS).forEach(([type, info]) => {
        const s = locks[type] || { mode: 'off', delete: false };
        const modeLabel = s.mode === 'off' ? '✔️ Off' : `${ACTION_ICONS[s.mode]} ${s.mode.charAt(0).toUpperCase() + s.mode.slice(1)}`;
        const delLabel = s.delete ? ` + ${ACTION_ICONS.delete}` : '';
        text += `${info.icon} ${info.label} = ${modeLabel}${delLabel}\n`;
    });

    return text;
}

export function createLockKeyboard(ctx: BotContext, page: number = 0) {
    const keyboard = new InlineKeyboard();
    const locks = ctx.session.locks || {};

    const entries = Object.entries(LOCK_ICONS);
    const ITEMS_PER_PAGE = 13; // 13 rows * 7 buttons = 91 buttons (well under Telegram's 100 limit)
    const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
    
    // Ensure page is within bounds
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const startIdx = page * ITEMS_PER_PAGE;
    const currentEntries = entries.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    currentEntries.forEach(([type, info]) => {
        const s = locks[type] || { mode: 'off', delete: false };

        // Media Icon
        keyboard.text(info.icon, 'noop');

        // Status buttons for each mode
        (['off', 'warn', 'kick', 'mute', 'ban'] as LockAction[]).forEach(mode => {
            const isActive = s.mode === mode;
            // Replace the active icon with a green checkmark for a clean, premium look
            const label = isActive ? '✅' : ACTION_ICONS[mode];
            keyboard.text(label, `lk:${type}:${mode}`);
        });

        // Deletion Toggle
        const isDelActive = s.delete;
        const delLabel = isDelActive ? '✅' : ACTION_ICONS.delete;
        keyboard.text(delLabel, `lk:${type}:delete`);

        keyboard.row();
    });

    // Pagination Row
    if (page === 0 && totalPages > 1) {
        keyboard.text('▶️ Other', 'lk:page:1');
    } else if (page > 0) {
        keyboard.text('◀️ Back', `lk:page:${page - 1}`);
        if (page < totalPages - 1) {
            keyboard.text('▶️ Other', `lk:page:${page + 1}`);
        }
    }
    
    // Always add a Done/Close button in a new row at the very bottom
    keyboard.row();
    keyboard.text('✅ Done', 'lk:close:now');

    return keyboard;
}
