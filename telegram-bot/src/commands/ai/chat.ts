import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';
import { isAdminOrOwner } from '../../utils/permissions';

// ── Layer 4: Output guard — identity confessions + wrong links ────────────────

const EXPLICIT_CONFESSION_PATTERNS = [
  /I am (gpt|chatgpt|claude|gemini|llama|mistral|openai|anthropic)/i,
  /I'?m (gpt|chatgpt|claude|gemini|llama|mistral)/i,
  /I was (made|built|created|trained) by (openai|anthropic|google|meta|mistral)/i,
  /I'?m (an? )?(gpt|claude|gemini|llama)[-\s]?\d/i,
  /powered by (openai|anthropic|google ai|meta ai)/i,
  /my (training|knowledge) cutoff (is|was)/i,
];

// Wrong/outdated links that must never appear in responses.
// Maps pattern → correct replacement URL.
const BANNED_LINK_REPLACEMENTS: Array<[RegExp, string]> = [
  // Any gitbook URL (old docs site or gitbook path) → Linktree
  [/https?:\/\/docs\.astarter\.io\S*/gi, 'https://linktr.ee/Astarter'],
  [/https?:\/\/astarter\.gitbook\.io\S*/gi, 'https://linktr.ee/Astarter'],
  // Old wrong announcement link (lowercase 'a')
  [/https?:\/\/t\.me\/astarteranncmnt(?!\w)/gi, 'https://t.me/Astarteranncmnt'],
];

function filterOutput(response: string): string {
  // 1. Identity confession guard
  if (EXPLICIT_CONFESSION_PATTERNS.some(p => p.test(response))) {
    console.warn('[OutputGuard] Explicit identity confession caught — replacing.');
    return `I'm ${process.env.BOT_NAME || 'your Astarter assistant'}! What can I help you with today? 😊`;
  }
  // 2. Replace banned/wrong links with correct ones
  let text = response;
  for (const [pattern, replacement] of BANNED_LINK_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}
// ─────────────────────────────────────────────────────────────────────────────

/** Parse HUMAN_MODERATOR_CHAT_ID safely — returns undefined if env var is missing or not a valid integer. */
function getModChatId(): number | undefined {
  const raw = process.env.HUMAN_MODERATOR_CHAT_ID;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

export default (bot: Bot<BotContext>) => {
  /**
   * Common AI Chat Handler
   */
  const handleAiChat = async (ctx: BotContext, message: string) => {
    try {
      // Check if AI is enabled for this chat
      if (ctx.chat?.type !== 'private' && ctx.session.aiEnabled === false) {
        return; // Silent ignore if disabled in groups
      }

      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
      const isGroup = ctx.chat?.type !== 'private';
      const replyToId = ctx.message?.message_id; // for reply-to-message in groups

      await ctx.replyWithChatAction('typing');

      const context = await aiService.getConversationContext(userId, chatId, 'telegram');

      const userMsgWithMention = `[Context: User is ${username}]\n${message}`;
      const response = await aiService.chat(context, userMsgWithMention);

      if (response.isEscalation) {
        await ctx.reply(
          '🔔 <b>Connecting you to a human moderator</b>\n\n' +
          'I could not find the answer in my knowledge base. A support agent has been notified.',
          {
            parse_mode: 'HTML',
            ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
          }
        );

        const modId = getModChatId();
        if (modId) {
          await ctx.api.sendMessage(
            modId,
            `🆘 <b>AI Escalation</b>\nUser: <code>${userId}</code>\nMsg: ${message.slice(0, 400)}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        return;
      }

      // Layer 4: Output filter — catch explicit identity confessions + wrong links
      let text = filterOutput(response.content);

      // ── Convert AI-generated content to Telegram-safe HTML ───────────────────
      // Telegram only supports: <b> <i> <u> <s> <a> <code> <pre> <tg-spoiler>

      // 0. Convert Markdown links [text](url) → <a href="url">text</a>
      //    Must run BEFORE the HTML stripper so anchors are preserved.
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

      // 1. Convert <h1>–<h6> headings → <b>text</b>\n
      text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n');

      // 2. Convert <li> items → bullet points (handle both <li>text</li> and bare <li>text)
      text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n');
      text = text.replace(/<li[^>]*>/gi, '• ');

      // 3. Strip list wrappers entirely (they're now just bullet lines)
      text = text.replace(/<\/?[uo]l[^>]*>/gi, '\n');

      // 4. Convert <p> and <br> → newlines
      text = text.replace(/<p[^>]*>/gi, '');
      text = text.replace(/<\/p>/gi, '\n\n');
      text = text.replace(/<br\s*\/?>/gi, '\n');

      // 5. Convert <strong> / <em> → Telegram equivalents
      text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>');
      text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>');

      // 6a. Rescue angle-bracket URLs like <https://...> before the tag stripper deletes them.
      //     Some AI models output <URL> as a plain-link shorthand — we convert to plain text URL.
      text = text.replace(/<(https?:\/\/[^>]+)>/g, '$1');

      // 6. Strip any remaining unsupported tags (keep allowed ones)
      const ALLOWED = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'tg-spoiler'];
      const stripPattern = new RegExp(
        `<(?!\\/?(?:${ALLOWED.join('|')})(?:\\s[^>]*)?>)[^>]+>`, 'gi'
      );
      text = text.replace(stripPattern, '');

      // 7. Convert Markdown bold **text** → <b>text</b>
      text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

      // 8. Convert Markdown italic _text_ → <i>text</i>
      text = text.replace(/(?<![_\w])_(.*?)_(?![_\w])/g, '<i>$1</i>');

      // 9. Clean up excess blank lines (max 2 consecutive newlines)
      text = text.replace(/\n{3,}/g, '\n\n').trim();
      // ─────────────────────────────────────────────────────────────────────────

      // Final guard: if transformations somehow produced an empty string, fall back
      if (!text) {
        text = 'You can find all official Astarter links at <a href="https://linktr.ee/Astarter">linktr.ee/Astarter</a> 🔗';
      }

      // In groups the reply already quotes the user's message (reply_parameters).
      // No need to prepend username — AI addresses them naturally in the response.
      // But ensure any @handle the AI put at the very top (as a bare line) is stripped
      // so we never have a naked "@username\nHey @username..." double-mention.
      if (isGroup) {
        text = text.replace(/^@[\w]+\s*\n/, '');
      }

      // Reply-to: quote the member's message in every group response
      const replyOpts = {
        parse_mode: 'HTML' as const,
        ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      };

      if (text.length > 4000) {
        // Split at newlines to avoid cutting mid HTML-tag or mid-word
        const chunks: string[] = [];
        let current = '';
        for (const line of text.split('\n')) {
          const next = current ? current + '\n' + line : line;
          if (next.length > 3900) {
            if (current) chunks.push(current.trim());
            current = line;
          } else {
            current = next;
          }
        }
        if (current.trim()) chunks.push(current.trim());
        for (const chunk of chunks) {
          if (chunk) await ctx.reply(chunk, replyOpts);
        }
      } else {
        await ctx.reply(text, replyOpts);
      }
    } catch (error: any) {
      console.error('AI Error:', error);

      // Send real error details to mod chat so issues can be diagnosed
      const modId = getModChatId();
      if (modId) {
        const errMsg = error?.message ?? String(error);
        ctx.api.sendMessage(
          modId,
          `⚠️ <b>AI Error</b>\nUser: <code>${ctx.from?.id}</code> (${ctx.from?.username ?? ctx.from?.first_name})\nMsg: ${message?.slice(0, 200)}\nError: <code>${errMsg.slice(0, 400)}</code>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      const isThrottle = (error?.message ?? '').toLowerCase().includes('throttl') ||
                         (error?.name ?? '').includes('Throttling') ||
                         (error?.message ?? '').toLowerCase().includes('too many requests');
      const userMsg = isThrottle
        ? '⏳ I\'m handling a lot of questions right now — please try again in a few seconds!'
        : '🤖 Something went wrong on my end. Please try again shortly.';
      await ctx.reply(userMsg);
    }
  };

  // Remove auto-chat logic. AI now only responds via /ask command.
  
  // /ask and /ai are identical — both trigger the AI chat handler
  const askHandler = async (ctx: BotContext) => {
    // DMs: auth middleware already guards this — but double-check for safety
    if (ctx.chat?.type === 'private' && !(await isAdminOrOwner(ctx))) return;

    const message = (ctx.match as string)?.trim();
    if (!message) {
      return ctx.reply(`💬 Usage: <code>/ask &lt;your question&gt;</code>`, { parse_mode: 'HTML' });
    }

    if (message.toLowerCase() === 'clear') {
      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      await aiService.clearConversationContext(userId, chatId, 'telegram');
      return ctx.reply('🗑️ Conversation history cleared.');
    }

    await handleAiChat(ctx, message);
  };

  bot.command('ask', askHandler);
  bot.command('ai', askHandler);

  bot.command('support', async (ctx) => {
    // Support command remains for everyone to reach mods
    const message = (ctx.match as string)?.trim();
    if (!message) {
      return ctx.reply('🙋 Usage: <code>/support &lt;issue&gt;</code>', { parse_mode: 'HTML' });
    }

    await ctx.reply('✅ <b>Support request sent!</b>\nA moderator will assist you shortly.', { parse_mode: 'HTML' });

    const modId = getModChatId();
    if (modId) {
      await ctx.api.sendMessage(
        modId,
        `🆘 <b>SUPPORT REQUEST</b>\nUser: <code>${ctx.from?.id}</code>\nIssue: ${message}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
};
