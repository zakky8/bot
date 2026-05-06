import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { isAdminOrOwner } from '../../utils/permissions';

export default (bot: Bot<BotContext>) => {
  bot.command('approve', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const reply = ctx.message?.reply_to_message;
    const target = reply?.from;

    if (!target) {
      return ctx.reply('❓ <b>Reply to a user</b> to approve them.', { parse_mode: 'HTML' });
    }

    if (!ctx.session.approvals) ctx.session.approvals = [];
    
    if (ctx.session.approvals.includes(target.id)) {
      return ctx.reply(`✅ <b>${target.first_name}</b> is already approved.`);
    }

    ctx.session.approvals.push(target.id);
    await ctx.reply(`✅ <b>${target.first_name}</b> has been approved. They are now immune to locks and filters.`, { parse_mode: 'HTML' });
  });

  bot.command('unapprove', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const reply = ctx.message?.reply_to_message;
    const target = reply?.from;

    if (!target) {
      return ctx.reply('❓ <b>Reply to a user</b> to unapprove them.', { parse_mode: 'HTML' });
    }

    if (!ctx.session.approvals) return ctx.reply('❌ No approved users in this chat.');

    const index = ctx.session.approvals.indexOf(target.id);
    if (index === -1) {
      return ctx.reply(`❌ <b>${target.first_name}</b> is not approved.`);
    }

    ctx.session.approvals.splice(index, 1);
    await ctx.reply(`❌ <b>${target.first_name}</b> is no longer approved.`, { parse_mode: 'HTML' });
  });

  bot.command('approved', async (ctx) => {
    if (!(await isAdminOrOwner(ctx))) return;

    const approved = ctx.session.approvals || [];
    if (approved.length === 0) {
      return ctx.reply('📋 <b>No approved users</b> in this chat.', { parse_mode: 'HTML' });
    }

    let text = '📋 <b>Approved Users:</b>\n\n';
    approved.forEach(id => text += `├ <code>${id}</code>\n`);
    
    await ctx.reply(text, { parse_mode: 'HTML' });
  });
};
