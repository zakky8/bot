import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';
import { isAdminOrOwner } from '../../utils/permissions';

// ── Deterministic link lookup — bypasses AI for simple link requests ──────────
// Keyed by lowercase keywords. Matched before the AI is called, so the correct
// URL is always returned regardless of what the model might hallucinate.
const LINK_LOOKUP: Array<{ keywords: string[]; url: string; label: string }> = [
  // ── Partner links — must come BEFORE generic keywords (e.g. 'mulan website' must not match the generic 'website' entry)
  { keywords: ['mulan website', 'mulan web', 'mulan link', 'mulan url', 'mulan.meme', 'mulan site'],
    url: 'https://mulan.meme', label: 'MULAN' },
  { keywords: ['paygo website', 'paygo link', 'paygo url', 'paygo web', 'paygo site'],
    url: 'https://www.paygo.ac', label: 'PayGo' },
  { keywords: ['zeus website', 'zeus link', 'zeus url', 'zeus web', 'zeus network link', 'zeus network site'],
    url: 'https://zeusnetwork.xyz', label: 'Zeus Network' },
  { keywords: ['eni website', 'eniac website', 'eni link', 'eniac link', 'eni url', 'eniac url', 'eniac web'],
    url: 'https://eniac.network', label: 'ENI / ENIAC' },
  // ── Astarter official links
  { keywords: ['gitbook', 'docs', 'documentation', 'whitepaper', 'guide', 'wiki', 'manual'],
    url: 'https://astarter.gitbook.io/astarter', label: 'Gitbook / Docs' },
  { keywords: ['website', 'homepage', 'web site', 'official site'],
    url: 'https://www.astarter.io', label: 'Website' },
  { keywords: ['discord'],
    url: 'https://discord.gg/XXDEjFPrgR', label: 'Discord' },
  { keywords: ['announcement', 'announce', 'ann channel', 'news channel'],
    url: 'https://t.me/Astarteranncmnt', label: 'Announcements Channel' },
  { keywords: ['telegram community', 'tg community', 'community group', 'community chat', 'tg group'],
    url: 'https://t.me/AstarterDefiHubOfficial', label: 'Telegram Community' },
  { keywords: ['twitter', ' x link', 'x account', 'tweet'],
    url: 'https://x.com/AstarterDefiHub', label: 'Twitter / X' },
  { keywords: ['medium', 'blog'],
    url: 'https://medium.com/@AstarterDefiHub', label: 'Medium' },
  { keywords: ['reddit'],
    url: 'https://www.reddit.com/r/Astarter/', label: 'Reddit' },
  { keywords: ['youtube', 'yt link', 'video channel'],
    url: 'https://youtube.com/c/astartertv', label: 'YouTube' },
  { keywords: ['zealy', 'quest', 'tasks'],
    url: 'https://zealy.io/cw/astarterdefihub/leaderboard', label: 'Zealy' },
  { keywords: [
      'linktree', 'all links', 'all socials', 'every link', 'social media',
      // Russian
      'социальные сети', 'соцсети', 'ссылки', 'все ссылки', 'все соцсети', 'социалки',
      // Turkish
      'sosyal medya', 'tüm linkler', 'bütün linkler',
      // Arabic
      'روابط', 'وسائل التواصل',
      // Spanish/Portuguese
      'redes sociales', 'todos los links', 'redes sociais',
      // Chinese
      '所有链接', '社交媒体',
    ],
    url: 'https://linktr.ee/Astarter', label: 'All Official Links' },
];

// Returns a match only when the message is clearly asking FOR a specific link —
// not when the user is asking ABOUT something that mentions a platform name.
function detectLinkRequest(message: string): { url: string; label: string } | null {
  const lower = message.toLowerCase().trim();

  // Must contain a link-intent signal — either an explicit request word or be very short (≤5 words)
  const wordCount = lower.split(/\s+/).length;
  const hasLinkIntent =
    /\b(link|url|website|site|page|channel|account|address|give|send|share|where)\b/.test(lower) ||
    // Russian: дай/дайте (give), ссылку/ссылки (link/links), покажи (show)
    /(дай|дайте|ссылк|покажи|соцсет|социальн)/.test(lower) ||
    wordCount <= 5;

  if (!hasLinkIntent) return null;

  for (const entry of LINK_LOOKUP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { url: entry.url, label: entry.label };
    }
  }

  // Catch-all: short "X links" queries not matched above (e.g. "astarter links",
  // "official links") → linktree has the complete up-to-date list
  if (wordCount <= 5 && /\blinks?\b/.test(lower)) {
    return { url: 'https://linktr.ee/Astarter', label: 'All Official Links' };
  }

  return null;
}

// ── Language detection — identifies non-Latin scripts for language memory ────
function detectScript(text: string): string | null {
  if (/[Ѐ-ӿ]/.test(text)) return 'Russian';
  if (/[؀-ۿ]/.test(text)) return 'Arabic';
  if (/[一-鿿]/.test(text)) return 'Chinese';
  if (/[가-힯]/.test(text)) return 'Korean';
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'Japanese';
  if (/[ऀ-ॿ]/.test(text)) return 'Hindi';
  if (/[฀-๿]/.test(text)) return 'Thai';
  if (/[Ͱ-Ͽ]/.test(text)) return 'Greek';
  return null;
}

// ── Per-user cooldown — blocks duplicate requests while one is in-flight ──────
// Map<userId, startTimestamp> — auto-expires after 60s so a failed request never permanently blocks
const aiInFlight = new Map<string, number>();

function isInFlight(userId: string): boolean {
  const started = aiInFlight.get(userId);
  if (!started) return false;
  if (Date.now() - started > 60_000) { aiInFlight.delete(userId); return false; } // auto-expire
  return true;
}

// ── Layer 4: Output guard — identity confessions + wrong links ────────────────

const EXPLICIT_CONFESSION_PATTERNS = [
  /I am (gpt|chatgpt|claude|gemini|llama|mistral|openai|anthropic)/i,
  /I'?m (gpt|chatgpt|claude|gemini|llama|mistral)/i,
  /I was (made|built|created|trained) by (openai|anthropic|google|meta|mistral)/i,
  /I'?m (an? )?(gpt|claude|gemini|llama)[-\s]?\d/i,
  /powered by (openai|anthropic|google ai|meta ai)/i,
  /my (training|knowledge) cutoff (is|was)/i,
];

const BANNED_LINK_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https?:\/\/docs\.astarter\.io\S*/gi, 'https://linktr.ee/Astarter'],
  [/https?:\/\/t\.me\/astarteranncmnt(?!\w)/gi, 'https://t.me/Astarteranncmnt'],
];

function filterOutput(response: string): string {
  if (EXPLICIT_CONFESSION_PATTERNS.some(p => p.test(response))) {
    console.warn('[OutputGuard] Explicit identity confession caught — replacing.');
    return `I'm ${process.env.BOT_NAME || 'your Astarter assistant'}! What can I help you with today? 😊`;
  }
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
  const handleAiChat = async (ctx: BotContext, message: string, mentionPrefix = '') => {
    const userId = ctx.from?.id?.toString() || 'unknown';
    const chatId = ctx.chat?.id?.toString();
    try {
      // Check if AI is enabled for this chat
      if (ctx.chat?.type !== 'private' && ctx.session.aiEnabled === false) {
        return; // Silent ignore if disabled in groups
      }

      const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
      const isGroup = ctx.chat?.type !== 'private';
      const replyToId = ctx.message?.message_id;

      await ctx.replyWithChatAction('typing');

      // ── Deterministic link lookup — instant path, no cooldown needed ──────
      const linkMatch = detectLinkRequest(message);
      if (linkMatch) {
        const replyOpts = {
          parse_mode: 'HTML' as const,
          ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
        };
        await ctx.reply(`Here's the Astarter <b>${linkMatch.label}</b>:\n${linkMatch.url}`, replyOpts);
        return;
      }

      // ── Cooldown: block duplicate AI requests while one is in-flight ──────
      if (isInFlight(userId)) {
        await ctx.reply('⏳ Still thinking about your last question — give me a moment!');
        return;
      }
      aiInFlight.set(userId, Date.now());

      // ── Language memory: detect script and store preference ───────────────
      const detectedLang = detectScript(message);
      if (detectedLang) {
        aiService.setUserLang(userId, detectedLang).catch(() => {});
      }
      const storedLang = detectedLang ?? await aiService.getUserLang(userId).catch(() => null);

      const context = await aiService.getConversationContext(userId, chatId, 'telegram');

      const langTag = storedLang ? ` | Language: ${storedLang}` : '';
      const userMsgWithMention = `[Context: User is ${username}${langTag}]\n${message}`;
      const response = await aiService.chat(context, userMsgWithMention);

      if (response.isEscalation) {
        aiInFlight.delete(userId); // release immediately on escalation
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

      // Strip any @handle the AI put at the very top to avoid double-mention.
      if (isGroup) {
        text = text.replace(/^@[\w]+\s*\n/, '');
      }

      // Prepend mention of the original message author so they get notified
      if (mentionPrefix) {
        text = `${mentionPrefix}\n${text}`;
      }

      // Reply-to: quote the member's message in every group response
      const replyOpts = {
        parse_mode: 'HTML' as const,
        ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      };

      if (text.length > 4000) {
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

      // ── Feedback buttons ──────────────────────────────────────────────────
      await ctx.reply('Was this helpful?', {
        reply_markup: {
          inline_keyboard: [[
            { text: '👍 Yes', callback_data: `fb_up:${userId}:${chatId ?? ''}` },
            { text: '👎 No',  callback_data: `fb_dn:${userId}:${chatId ?? ''}` },
          ]],
        },
      }).catch(() => {}); // non-critical — swallow if it fails

      // Release cooldown 5s after successful response
      setTimeout(() => aiInFlight.delete(userId), 5000);

    } catch (error: any) {
      aiInFlight.delete(userId); // always release on error
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

    const typedText = (ctx.match as string)?.trim();

    // clear must match only explicitly typed text, never a replied message
    if (typedText?.toLowerCase() === 'clear') {
      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      await aiService.clearConversationContext(userId, chatId, 'telegram');
      return ctx.reply('🗑️ Conversation history cleared.');
    }

    let message = typedText;

    // Reply-to support: /ai sent as a reply to another message
    const repliedMsg = ctx.message?.reply_to_message;
    let mentionPrefix = '';

    if (repliedMsg) {
      const repliedText = (repliedMsg.text || repliedMsg.caption || '').trim();
      if (!repliedText) {
        return ctx.reply(
          '💬 That message has no text. Reply to a text message or type your question after <code>/ai</code>.',
          { parse_mode: 'HTML' }
        );
      }
      const safeRepliedText = repliedText.slice(0, 1000);
      if (!message) {
        message = safeRepliedText;
      } else {
        message = `${message}\n\n[Referring to: "${safeRepliedText}"]`;
      }

      // Build mention for the original message author (C) so they get notified
      const isGroup = ctx.chat?.type !== 'private';
      const author = repliedMsg.from;
      if (isGroup && author && !author.is_bot && author.id !== ctx.from?.id) {
        mentionPrefix = author.username
          ? `@${author.username}`
          : `<a href="tg://user?id=${author.id}">${author.first_name}</a>`;
      }
    }

    if (!message) {
      return ctx.reply(
        `💬 Usage: <code>/ask &lt;your question&gt;</code> or reply to any message with <code>/ask</code>`,
        { parse_mode: 'HTML' }
      );
    }

    await handleAiChat(ctx, message, mentionPrefix);
  };

  bot.command('ask', askHandler);
  bot.command('ai', askHandler);

  // ── Feedback callback handler ─────────────────────────────────────────────
  bot.callbackQuery(/^fb_(up|dn):/, async (ctx) => {
    try {
      const [action, userId, chatId] = ctx.callbackQuery.data.split(':');
      const helpful = action === 'fb_up';
      await aiService.storeFeedback(userId, chatId || undefined, helpful).catch(() => {});
      await ctx.editMessageText(helpful
        ? '👍 Thanks — glad that helped!'
        : '👎 Thanks for the feedback — we\'ll keep improving!',
      ).catch(() => {});
      await ctx.answerCallbackQuery();
    } catch {
      await ctx.answerCallbackQuery().catch(() => {});
    }
  });

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
