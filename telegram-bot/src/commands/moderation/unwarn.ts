import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { query } from '../../core/database';
import { resolveUser } from '../../utils/user';

export default (bot: Bot<BotContext>) => {
    bot.command('unwarn', async (ctx: BotContext) => {
        try {
            if (!ctx.chat || ctx.chat.type === 'private') return ctx.reply('Groups only.');
            const admins = await ctx.getChatAdministrators();
            if (!admins.some(a => a.user.id === ctx.from?.id)) return ctx.reply('❌ <b>Access Denied:</b> You need administrative privileges to use this command.', { parse_mode: 'HTML' }).then(msg => { setTimeout(() => { ctx.deleteMessage().catch(()=>{}); ctx.api.deleteMessage(ctx.chat!.id, msg.message_id).catch(()=>{}); }, 5000); });
 
            const reply = ctx.message?.reply_to_message;
            let targetId: number | undefined;
            let targetName: string | undefined;

            const args = ctx.message?.text?.split(/\s+/) || [];
            const cmdArgs = args.slice(1);

            if (reply?.from) {
                targetId = reply.from.id;
                targetName = reply.from.first_name || 'Unknown';
            } else if (cmdArgs.length > 0) {
                const resolved = await resolveUser(ctx, cmdArgs[0]);
                if (resolved) {
                    targetId = resolved.id;
                    targetName = resolved.name;
                } else {
                    return ctx.reply(`❌ Could not find a user with the identifier ${cmdArgs[0]}.`);
                }
            }

            if (!targetId) return ctx.reply('❌ Reply to a user or provide a username/ID to remove their last warning.');

            const result = await query(
                'SELECT id FROM warnings WHERE user_id = $1 AND chat_id = $2 ORDER BY created_at DESC LIMIT 1',
                [targetId, ctx.chat.id]
            );

            if (result.rows.length === 0) return ctx.reply('✅ This user has no warnings.');

            await query('DELETE FROM warnings WHERE id = $1', [result.rows[0].id]);
            
            const countResult = await query('SELECT COUNT(*) as count FROM warnings WHERE user_id = $1 AND chat_id = $2', [targetId, ctx.chat.id]);

            await ctx.reply(`✅ Removed last warning from <b>${targetName}</b>. Remaining: ${countResult.rows[0].count}`, { parse_mode: 'HTML' });
        } catch (error) { console.error('unwarn error:', error); await ctx.reply('❌ An error occurred.'); }
    });
};
