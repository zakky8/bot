import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';

export default (bot: Bot<BotContext>) => {
  /**
   * Common AI Chat Handler
   */
  const handleAiChat = async (ctx: BotContext, message: string) => {
    try {
      // 1. Check if AI is enabled for this chat
      if (ctx.chat?.type !== 'private' && ctx.session.aiEnabled === false) {
        return; // Silent ignore if disabled in groups
      }

      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');

      await ctx.replyWithChatAction('typing');

      const context = await aiService.getConversationContext(userId, chatId, 'telegram');
      
      // Pass the username to the AI so it can mention the user
      const userMsgWithMention = `[Context: User is ${username}]\n${message}`;
      
      const response = await aiService.chat(context, userMsgWithMention);

      if (response.isEscalation) {
        await ctx.reply(
          '🔔 <b>Connecting you to a human moderator</b>\n\n' +
          'I could not find the answer in my knowledge base. A support agent has been notified.',
          { parse_mode: 'HTML' }
        );

        // Notify moderator
        const modChatId = process.env.HUMAN_MODERATOR_CHAT_ID;
        if (modChatId) {
          await ctx.api.sendMessage(
            parseInt(modChatId, 10),
            `🆘 <b>AI Escalation</b>\nUser: <code>${userId}</code>\nMsg: ${message.slice(0, 400)}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        return;
      }

      // Handle response and sanitize for Telegram HTML
      let text = response.content;
      
      // FOOLPROOF HTML CLEANUP: 
      // 1. Replace illegal angle brackets (like <https://...>) that aren't tags
      text = text.replace(/<(?!(\/?(b|i|u|s|a|code|pre)\b))/g, '&lt;');
      text = text.replace(/(?<!(\b(b|i|u|s|a|code|pre)))>/g, '&gt;');
      
      // 2. Also fix some AI's habit of using Markdown bold inside HTML mode
      text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

      // 3. Ensure the AI mentions the user if it didn't already
      if (!text.includes(username)) {
        text = `${username} ${text}`;
      }

      if (text.length > 4000) {
        const chunks = text.match(/.{1,4000}/gs) || [text];
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'HTML' });
        }
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      console.error('AI Error:', error);
      await ctx.reply('🤖 AI is temporarily unavailable. Please try again later.');
    }
  };

  bot.on('message:text', async (ctx, next) => {
    const botUser = await bot.api.getMe();
    const isMention = ctx.msg.text.includes(`@${botUser.username}`);
    const isReplyToBot = ctx.msg.reply_to_message?.from?.id === botUser.id;

    if (isMention || isReplyToBot || ctx.chat.type === 'private') {
        const text = ctx.msg.text.replace(`@${botUser.username}`, '').trim();
        if (text.startsWith('/')) return next(); // Let commands handle it
        return handleAiChat(ctx, text);
    }
    return next();
  });

  bot.command(['chat', 'ask'], async (ctx) => {
    const message = (ctx.match as string)?.trim();
    if (!message) {
      const cmd = ctx.msg?.text?.split(' ')[0] || '/chat';
      return ctx.reply(`💬 Usage: <code>${cmd} &lt;message&gt;</code>`, { parse_mode: 'HTML' });
    }

    if (message.toLowerCase() === 'clear') {
      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      await aiService.clearConversationContext(userId, chatId, 'telegram');
      return ctx.reply('🗑️ Conversation history cleared.');
    }

    await handleAiChat(ctx, message);
  });

  bot.command('support', async (ctx) => {
    const message = (ctx.match as string)?.trim();
    if (!message) {
      return ctx.reply('🙋 Usage: <code>/support &lt;issue&gt;</code>', { parse_mode: 'HTML' });
    }

    await ctx.reply('✅ <b>Support request sent!</b>\nA moderator will assist you shortly.', { parse_mode: 'HTML' });

    const modChatId = process.env.HUMAN_MODERATOR_CHAT_ID;
    if (modChatId) {
      await ctx.api.sendMessage(
        parseInt(modChatId, 10),
        `🆘 <b>SUPPORT REQUEST</b>\nUser: <code>${ctx.from?.id}</code>\nIssue: ${message}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
};
