import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';
import axios from 'axios';

const LANGGRAPH_URL = process.env.LANGGRAPH_SERVICE_URL || 'http://127.0.0.1:8001';
const LANGGRAPH_TIMEOUT = 25_000;

interface LangGraphResponse {
  response: string;
  intent: string;
  sentiment: string;
  escalate: boolean;
  sources: string[];
}

async function callLangGraph(
  chatId: number,
  message: string,
  username?: string,
  firstName?: string,
  language?: string,
): Promise<LangGraphResponse | null> {
  try {
    const { data } = await axios.post<LangGraphResponse>(
      `${LANGGRAPH_URL}/chat`,
      { chat_id: chatId, message, username, first_name: firstName, language },
      { timeout: LANGGRAPH_TIMEOUT, headers: { 'Content-Type': 'application/json' } },
    );
    return data;
  } catch {
    return null;
  }
}

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
  { keywords: ['twitter', 'x link', 'x account', 'tweet'],
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

// ── Telegram HTML formatter — converts AI output to Telegram-safe HTML ────────
// Approach inspired by OpenClaw's format.ts: convert markdown first, then
// preserve only supported Telegram HTML tags, strip the rest.

/** Telegram-supported simple tags (no attributes needed) */
const TG_SIMPLE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'tg-spoiler', 'blockquote']);

/** Escape plain-text ampersands and angle brackets that aren't part of HTML tags */
function escapeTelegramHtml(text: string): string {
  return text.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z]{1,10});)/gi, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
}

function formatForTelegram(raw: string): string {
  let text = raw;

  // 0. Escape bare ampersands that aren't already HTML entities.
  //    Must run BEFORE tag processing. We only escape & here — not < or > — because
  //    the AI outputs <b>/<code>/<i> tags directly and the formatter handles the rest.
  text = text.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z]{1,10});)/gi, '&amp;');

  // 1. Convert markdown links [text](url) → <a href="url">text</a>
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

  // 2. Convert markdown bold/italic before tag processing
  text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  text = text.replace(/(?<![_\w])_(.*?)_(?![_\w])/g, '<i>$1</i>');

  // 3. Normalise structural HTML → plain equivalents
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n');
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<\/?[uo]l[^>]*>/gi, '\n');
  text = text.replace(/<p[^>]*>/gi, '');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 4. Unwrap raw angle-bracket URLs like <https://...>
  text = text.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // 5. Strip any HTML tag that Telegram doesn't support.
  //    Keep: simple tags from TG_SIMPLE_TAGS + <a href="...">
  //    Inspired by OpenClaw's preserveSupportedTelegramHtmlTags logic.
  text = text.replace(/<(\/?)([\w-]+)([^>]*)>/gi, (_match, slash: string, tag: string, attrs: string) => {
    const lower = tag.toLowerCase();
    if (TG_SIMPLE_TAGS.has(lower) && attrs.trim() === '') return `<${slash}${lower}>`;
    if (lower === 'a' && !slash && /href="[^"]+"/i.test(attrs)) return `<a${attrs}>`;
    if (lower === 'a' && slash) return '</a>';
    return ''; // strip everything else
  });

  // 6. Collapse 3+ newlines → 2
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
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
    return `I'm ${process.env.BOT_NAME || 'TENET'}! What can I help you with today? 😊`;
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
  const handleAiChat = async (ctx: BotContext, message: string, mentionPrefix = '', forceLang: string | null = null) => {
    const userId = ctx.from?.id?.toString() || 'unknown';
    const chatId = ctx.chat?.id?.toString();
    let statusMsgId: number | null = null;

    try {
      if (ctx.chat?.type !== 'private' && ctx.session.aiEnabled === false) {
        return; // AI explicitly disabled for this group by an admin
      }

      const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
      const isGroup = ctx.chat?.type !== 'private';
      const replyToId = ctx.message?.message_id;
      const replyOpts = {
        parse_mode: 'HTML' as const,
        ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      };

      // ── Deterministic link lookup — instant, no streaming needed ────────────
      const linkMatch = detectLinkRequest(message);
      if (linkMatch) {
        await ctx.reply(`Here's the Astarter <b>${linkMatch.label}</b>:\n${linkMatch.url}`, replyOpts);
        return;
      }

      // ── Language detection ────────────────────────────────────────────────
      // Detect from current message only. If nothing detected (e.g. Latin script)
      // and a forceLang was passed (sender's stored language from a pure /ai reply),
      // use that so the reply comes back in the sender's language, not the replied msg's.
      const detectedLang = detectScript(message);
      if (detectedLang) aiService.setUserLang(userId, detectedLang).catch(() => {});

      // ── Step 1: instant acknowledgment so user knows the bot received the message ──
      const statusMsg = await ctx.reply('🔍 <i>Looking into that...</i>', {
        parse_mode: 'HTML',
        ...(isGroup && replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      });
      statusMsgId = statusMsg.message_id;

      // ── Step 2: fetch AI response (LangGraph → fallback to aiService) ──────
      const activeLang = detectedLang ?? forceLang;
      const langTag = activeLang ? ` | Language: ${activeLang}` : '';

      let responseText: string;
      let isEscalation = false;

      const lgResult = await callLangGraph(
        ctx.chat!.id,
        message,
        ctx.from?.username,
        ctx.from?.first_name,
        activeLang ?? undefined,
      );

      if (lgResult) {
        responseText = lgResult.response;
        isEscalation = lgResult.escalate;
      } else {
        const context = await aiService.getConversationContext(userId, chatId, 'telegram');
        const userMsgWithMention = `[Context: User is ${username}${langTag}]\n${message}`;
        const response = await aiService.chat(context, userMsgWithMention);
        responseText = response.content;
        isEscalation = response.isEscalation ?? false;
      }

      // ── Escalation ────────────────────────────────────────────────────────
      if (isEscalation) {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsgId,
          '🔔 <b>Connecting you to a human moderator</b>\n\nI could not find the answer in my knowledge base. A support agent has been notified.',
          { parse_mode: 'HTML' }
        ).catch(() => {});
        const modId = getModChatId();
        if (modId) {
          await ctx.api.sendMessage(modId, `🆘 <b>AI Escalation</b>\nUser: <code>${userId}</code>\nMsg: ${message.slice(0, 400)}`, { parse_mode: 'HTML' }).catch(() => {});
        }
        return;
      }

      // ── Step 3: format and replace the status message with the final answer ──
      let text = filterOutput(responseText);
      text = formatForTelegram(text);

      // ── Ensure "Short answer:" label is bold (model often drops the tags) ──────
      text = text.replace(/^Short answer:\s*/i, '<b>Short answer:</b> ');

      // ── Announcements channel link injection ──────────────────────────────────
      const ANN_URL = 'https://t.me/Astarteranncmnt';

      // Step 1: Replace "announcements channel" text (with or without trailing raw URL) → <a> link
      text = text.replace(
        /announcements?\s*channel(?:\s*\(?https?:\/\/t\.me\/Astarteranncmnt[^\s)]*\)?)?/gi,
        `<a href="${ANN_URL}">announcements channel</a>`
      );
      // Step 2: Strip any leftover raw URL not inside an href
      text = text.replace(/(?<!href=")https?:\/\/t\.me\/Astarteranncmnt\S*/gi, '');

      // Step 3: Dead-end guard — if the reply is a "not announced/confirmed yet" answer
      // and still has no channel reference, inject one. The model often truncates the
      // NEVER FABRICATE table's suggested phrasing before reaching the channel part.
      const NOT_YET = [
        /hasn't been officially (published|announced|confirmed)/i,
        /have?n't been officially/i,
        /not (yet )?(officially )?(published|announced|confirmed)/i,
        /exact (date|price|amount|figure) hasn't been/i,
        /no .{0,30}(price|date|apy|figure).{0,30}(confirmed|announced|published)/i,
      ];
      const hasChannelRef = text.includes('announcements channel') || text.includes(ANN_URL);
      if (!hasChannelRef && NOT_YET.some(p => p.test(text))) {
        // Trim any trailing follow-up question (model adds one per instructions, but
        // the channel mention is a better closer for dead-end "not confirmed" replies)
        text = text.replace(/\n\n[A-Z][^\n]{5,120}\?\s*$/, '').trim();
        text += `\n\nWatch the <a href="${ANN_URL}">announcements channel</a> — that's where it'll be announced first.`;
      }
      if (!text) text = 'You can find all official Astarter links at <a href="https://linktr.ee/Astarter">linktr.ee/Astarter</a> 🔗';
      if (isGroup) text = text.replace(/^@[\w]+\s*\n/, '');
      if (mentionPrefix) text = `${mentionPrefix}\n${text}`;

      if (text.length > 4000) {
        // Too long for one message — delete status and send as chunks
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsgId).catch(() => {});
        let current = '';
        const chunks: string[] = [];
        for (const line of text.split('\n')) {
          const next = current ? current + '\n' + line : line;
          if (next.length > 3900) { if (current) chunks.push(current.trim()); current = line; }
          else current = next;
        }
        if (current.trim()) chunks.push(current.trim());
        for (const chunk of chunks) {
          if (!chunk) continue;
          await ctx.reply(chunk, replyOpts);
        }
      } else {
        const edited = await ctx.api.editMessageText(ctx.chat!.id, statusMsgId, text, {
          parse_mode: 'HTML',
        }).catch(() => null);

        if (!edited) {
          await ctx.reply(text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }

    } catch (error: any) {
      if (statusMsgId && ctx.chat?.id) {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});
      }
      console.error('AI Error:', error);
      const modId = getModChatId();
      if (modId) {
        const errMsg = error?.message ?? String(error);
        ctx.api.sendMessage(modId, `⚠️ <b>AI Error</b>\nUser: <code>${ctx.from?.id}</code> (${ctx.from?.username ?? ctx.from?.first_name})\nMsg: ${message?.slice(0, 200)}\nError: <code>${errMsg.slice(0, 400)}</code>`, { parse_mode: 'HTML' }).catch(() => {});
      }
      const isThrottle = (error?.message ?? '').toLowerCase().includes('throttl') || (error?.name ?? '').includes('Throttling') || (error?.message ?? '').toLowerCase().includes('too many requests');
      await ctx.reply(isThrottle ? '⏳ I\'m handling a lot of questions right now — please try again in a few seconds!' : '🤖 Something went wrong on my end. Please try again shortly.');
    }
  };

  // ── Helper: check if user can use /ai ────────────────────────────────────────
  // DM: only ADMIN_IDS (bot owner + bot-level admins)
  // Groups: ADMIN_IDS OR group admin/creator via Telegram API
  const isAdminOrOwner = async (ctx: BotContext): Promise<boolean> => {
    const userId = ctx.from?.id;
    if (!userId) return false;

    // Bot owner + bot-level admins — read from OWNER_ID and ADMIN_IDS env vars
    const rawIds = [
      ...(process.env.OWNER_ID || '').split(','),
      ...(process.env.ADMIN_IDS || '').split(','),
    ];
    const adminIds = rawIds.map(id => parseInt(id.trim(), 10)).filter(n => !isNaN(n));
    if (adminIds.includes(userId)) return true;

    // Groups only: also allow Telegram group admins/creators
    if (ctx.chat?.type !== 'private') {
      try {
        const member = await ctx.getChatMember(userId);
        return ['creator', 'administrator'].includes(member.status);
      } catch {
        return false;
      }
    }

    return false;
  };

  // ── /ask — public question command (typed text only) ─────────────────────────
  bot.command('ask', async (ctx: BotContext) => {
    const typedText = (ctx.match as string)?.trim();

    // clear conversation history
    if (typedText?.toLowerCase() === 'clear') {
      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id?.toString();
      await aiService.clearConversationContext(userId, chatId, 'telegram');
      return ctx.reply('🗑️ Conversation history cleared.');
    }

    // Must have typed text — /ask does not read replied messages
    if (!typedText) {
      return ctx.reply(
        `💬 Usage: <code>/ask &lt;your question&gt;</code>`,
        { parse_mode: 'HTML' }
      );
    }

    await handleAiChat(ctx, typedText, '', null);
  });

  // ── /ai — admin-only reply reader ────────────────────────────────────────────
  bot.command('ai', async (ctx: BotContext) => {
    // 1. Admin gate
    if (!await isAdminOrOwner(ctx)) {
      return ctx.reply('🔒 This command is for admins only.');
    }

    // 2. Must be used as a reply to a message
    const repliedMsg = ctx.message?.reply_to_message;
    if (!repliedMsg) {
      return ctx.reply(
        `💬 Usage: reply to any message with <code>/ai</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const repliedText = (repliedMsg.text || repliedMsg.caption || '').trim();
    if (!repliedText) {
      return ctx.reply(
        '💬 That message has no text. Reply to a text message with <code>/ai</code>.',
        { parse_mode: 'HTML' }
      );
    }

    // 3. Build the message — replied text is always the base context
    const typedText = (ctx.match as string)?.trim();
    const safeRepliedText = repliedText.slice(0, 1000);
    const message = typedText
      ? `${typedText}\n\n[Referring to: "${safeRepliedText}"]`
      : safeRepliedText;

    // 4. Mention the original message author so they get notified
    let mentionPrefix = '';
    const isGroup = ctx.chat?.type !== 'private';
    const author = repliedMsg.from;
    if (isGroup && author && !author.is_bot && author.id !== ctx.from?.id) {
      mentionPrefix = author.username
        ? `@${author.username}`
        : `<a href="tg://user?id=${author.id}">${author.first_name}</a>`;
    }

    // 5. Use admin's stored language preference for the reply
    const forceLang = !typedText
      ? await aiService.getUserLang(ctx.from?.id?.toString() || 'unknown').catch(() => null)
      : null;

    await handleAiChat(ctx, message, mentionPrefix, forceLang);
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
