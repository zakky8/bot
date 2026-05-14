import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';
import { isOwner, isBotAdmin, denyAccess } from '../../utils/permissions';
import axios from 'axios';
import * as cheerio from 'cheerio';

// pdf-parse v2 class-based API (NOT the old v1 function call)
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

// ── Scraper headers — mimics a real Chrome browser ────────────────────────────
const SCRAPER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
    'image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Referer: 'https://www.google.com/',
  'Upgrade-Insecure-Requests': '1',
};

// ── PDF extraction (pdf-parse v2) ─────────────────────────────────────────────
async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text?.trim() || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ── URL scraping with multi-strategy fallback ─────────────────────────────────
async function scrapeUrl(url: string): Promise<string> {
  // Medium: use their RSS feed (bypasses 403)
  if (url.includes('medium.com')) {
    url = url.replace('medium.com/', 'medium.com/feed/');
  }

  const res = await axios.get(url, {
    headers: SCRAPER_HEADERS,
    timeout: 15000,
    maxContentLength: 5 * 1024 * 1024, // 5 MB cap
  });

  const raw: string = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const ct: string = (String(res.headers['content-type'] || '')).toLowerCase();

  // RSS / Atom / XML feed
  if (ct.includes('xml') || url.includes('/feed')) {
    const items =
      raw.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/g) ||
      raw.match(/<description>([\s\S]*?)<\/description>/g) ||
      [];
    const text = items
      .map((i: string) => i.replace(/<[^>]+>/g, ' '))
      .join('\n\n')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 100) return text;
  }

  // JSON — stringify it
  if (ct.includes('json')) {
    return JSON.stringify(res.data, null, 2).slice(0, 20000);
  }

  // HTML — cheerio extraction with readability-style selector priority
  const $ = cheerio.load(raw);
  $('script, style, nav, footer, header, aside, .ad, #ad, [role="banner"]').remove();

  // Try semantic content containers first (common CMS patterns)
  const SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '.article-body',
    '.content',
    '#content',
    'body',
  ];

  let text = '';
  for (const sel of SELECTORS) {
    const candidate = $(sel).first().text().replace(/\s+/g, ' ').trim();
    if (candidate.length >= 200) {
      text = candidate;
      break;
    }
  }

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────

export default (bot: Bot<BotContext>) => {
  // ── /aion  /aioff ──────────────────────────────────────────────────────────
  bot.command(['aion', 'aioff'], async (ctx: BotContext) => {
    if (!isBotAdmin(ctx)) return denyAccess(ctx, true);
    const enabled = ctx.message?.text?.includes('aion');
    ctx.session.aiEnabled = enabled;
    return ctx.reply(`🤖 AI is now ${enabled ? '✅ ENABLED' : '❌ DISABLED'} for this chat.`);
  });

  // ── /adddoc ────────────────────────────────────────────────────────────────
  bot.command('adddoc', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);

    let inputText = (ctx.match as string)?.trim();
    const replyMsg = ctx.message?.reply_to_message;

    // ── Case 1: replying to a document ──────────────────────────────────────
    if (replyMsg?.document) {
      const doc = replyMsg.document;
      const fileName = doc.file_name || 'unknown';
      const ext = fileName.split('.').pop()?.toLowerCase() || '';

      await ctx.reply(`📥 Downloading <b>${fileName}</b>…`, { parse_mode: 'HTML' });

      try {
        const telegramFile = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${telegramFile.file_path}`;
        const dlRes = await axios.get(fileUrl, {
          responseType: 'arraybuffer',
          headers: SCRAPER_HEADERS,
          timeout: 30000,
        });
        const buffer = Buffer.from(dlRes.data as ArrayBuffer);

        let content = '';

        if (ext === 'pdf') {
          await ctx.reply('🔍 Extracting PDF text…');
          content = await extractPdf(buffer);
        } else if (ext === 'docx') {
          await ctx.reply('🔍 Extracting DOCX text…');
          const result = await mammoth.extractRawText({ buffer });
          content = result.value?.trim() || '';
        } else if (['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm'].includes(ext)) {
          content = buffer.toString('utf-8').trim();
        } else {
          return ctx.reply(
            `⚠️ Unsupported file type <b>.${ext}</b>.\n` +
            `Supported: PDF, DOCX, TXT, MD, CSV, JSON, XML, HTML`,
            { parse_mode: 'HTML' }
          );
        }

        if (!content || content.length < 20) {
          return ctx.reply('⚠️ The file appears to be empty or could not be read.');
        }

        await ctx.reply(`⚙️ Indexing ${content.length.toLocaleString()} characters…`);
        await aiService.addDocument(content, { source: fileName, type: 'manual', ext });

        return ctx.reply(`✅ <b>${fileName}</b> indexed successfully! (${content.length.toLocaleString()} chars)`, {
          parse_mode: 'HTML',
        });
      } catch (err: any) {
        console.error('[adddoc file]', err);
        return ctx.reply(
          `❌ <b>Failed to process file:</b>\n<code>${err?.message || err}</code>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    if (!inputText) {
      return ctx.reply(
        '📝 <b>Usage:</b>\n' +
        '• <code>/adddoc &lt;text or URL&gt;</code>\n' +
        '• Reply to a file with <code>/adddoc</code>\n\n' +
        '<b>Supported files:</b> PDF, DOCX, TXT, MD, CSV, JSON\n' +
        '<b>Supported URLs:</b> any webpage, RSS feed, Medium article',
        { parse_mode: 'HTML' }
      );
    }

    // ── Case 2: URL ───────────────────────────────────────────────────────────
    if (inputText.startsWith('http://') || inputText.startsWith('https://')) {
      await ctx.reply('🌐 Scraping URL…');
      try {
        const content = await scrapeUrl(inputText);

        if (!content || content.length < 100) {
          return ctx.reply(
            '⚠️ Scraped content is too short or empty.\n' +
            'The site may be JS-rendered or blocking scrapers.\n' +
            'Try copying the text manually and using <code>/adddoc &lt;text&gt;</code>.',
            { parse_mode: 'HTML' }
          );
        }

        await ctx.reply(`⚙️ Indexing ${content.length.toLocaleString()} characters…`);
        await aiService.addDocument(content, {
          source: inputText,
          type: 'manual',
          date: new Date().toISOString(),
          added_by: ctx.from?.id,
        });

        return ctx.reply(
          `✅ URL indexed! (<b>${content.length.toLocaleString()}</b> chars)\n<code>${inputText.slice(0, 80)}</code>`,
          { parse_mode: 'HTML' }
        );
      } catch (err: any) {
        console.error('[adddoc url]', err);
        return ctx.reply(
          `❌ <b>Scraping failed:</b>\n<code>${err?.message || err}</code>\n\n` +
          'Try copying the text and using <code>/adddoc &lt;text&gt;</code>.',
          { parse_mode: 'HTML' }
        );
      }
    }

    // ── Case 3: raw text ──────────────────────────────────────────────────────
    if (inputText.length < 10) {
      return ctx.reply('⚠️ Text is too short to index (min 10 characters).');
    }
    try {
      await aiService.addDocument(inputText, {
        type: 'manual',
        date: new Date().toISOString(),
        added_by: ctx.from?.id,
      });
      return ctx.reply(`✅ Text indexed! (${inputText.length.toLocaleString()} chars)`);
    } catch (err: any) {
      console.error('[adddoc text]', err);
      return ctx.reply(`❌ <b>Indexing failed:</b>\n<code>${err?.message || err}</code>`, { parse_mode: 'HTML' });
    }
  });

  // ── /docstats ──────────────────────────────────────────────────────────────
  bot.command('docstats', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    const count = aiService.getDocCount();
    return ctx.reply(
      '📊 <b>Knowledge Base Status</b>\n\n' +
      `Indexed chunks: <code>${count}</code>\n` +
      'Embed model: <code>amazon.titan-embed-text-v2:0</code>\n' +
      'Region: <code>eu-north-1</code>\n' +
      'Storage: <code>Local JSON vector store</code>\n' +
      `Status: <code>${count > 0 ? '✅ Active — data loaded' : '⚠️ Empty — use /adddoc'}</code>`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /testsearch ────────────────────────────────────────────────────────────
  bot.command('testsearch', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    const query = (ctx.match as string)?.trim();
    if (!query) return ctx.reply('Usage: <code>/testsearch &lt;your query&gt;</code>', { parse_mode: 'HTML' });

    const count = aiService.getDocCount();
    if (count === 0) return ctx.reply('⚠️ Knowledge base is empty. Use /adddoc first.');

    await ctx.reply(`🔍 Searching <b>${count} chunks</b> for: <code>${query}</code>…`, { parse_mode: 'HTML' });

    try {
      const results = await aiService.searchDocs(query, 5, ['astarter_deck', 'manual']);

      if (results.length === 0) {
        return ctx.reply(
          '❌ <b>No chunks found</b> for this query.\n\n' +
          'The document may not be indexed or similarity is too low.\n' +
          'Try <code>/docstats</code> to check KB status.',
          { parse_mode: 'HTML' }
        );
      }

      const lines = results.map((r, i) => {
        const score = r.score.toFixed(3);
        const threshold = r.score >= 0.35 ? '✅' : '❌ below threshold';
        const preview = r.pageContent.slice(0, 120).replace(/\n/g, ' ');
        const type = r.metadata?.type ?? 'unknown';
        return `<b>#${i + 1}</b> score: <code>${score}</code> ${threshold} [${type}]\n<i>${preview}…</i>`;
      });

      return ctx.reply(
        `📊 <b>Top ${results.length} results</b> (threshold: 0.35):\n\n` + lines.join('\n\n'),
        { parse_mode: 'HTML' }
      );
    } catch (err: any) {
      return ctx.reply(`❌ Error: <code>${err?.message}</code>`, { parse_mode: 'HTML' });
    }
  });

  // ── /updatedocs ────────────────────────────────────────────────────────────
  bot.command('updatedocs', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    aiService.reloadFaq();
    return ctx.reply('✅ FAQ reloaded and reindexed.');
  });

  // ── /removedoc ─────────────────────────────────────────────────────────────
  bot.command('removedoc', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    const source = (ctx.match as string)?.trim();
    if (!source) {
      return ctx.reply('🗑️ Usage: <code>/removedoc &lt;filename or URL&gt;</code>', { parse_mode: 'HTML' });
    }
    await ctx.reply(`🗑️ Removing: <code>${source}</code>…`, { parse_mode: 'HTML' });
    try {
      await aiService.removeDocumentBySource(source);
      return ctx.reply(`✅ Removed all chunks from "<code>${source}</code>".`, { parse_mode: 'HTML' });
    } catch (err: any) {
      return ctx.reply(`❌ <b>Error:</b> <code>${err?.message || err}</code>`, { parse_mode: 'HTML' });
    }
  });

  // ── /clearall ──────────────────────────────────────────────────────────────
  bot.command('clearall', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    await aiService.clearKnowledgeBase();
    return ctx.reply('🗑️ Knowledge base cleared.');
  });
};
