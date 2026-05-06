import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService } from '../../core/ai';
import { isOwner, denyAccess } from '../../utils/permissions';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
const pdf = require('pdf-parse');

// Advanced headers to mimic a real browser and bypass aggressive bot detection (like Medium)
const SCRAPER_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1'
    }
};

export default (bot: Bot<BotContext>) => {
  bot.command(['aion', 'aioff'], async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    
    const enabled = ctx.message?.text?.includes('aion');
    // Store in session or DB (simplified here to session for now)
    ctx.session.aiEnabled = enabled;
    
    return ctx.reply(`🤖 AI is now ${enabled ? '✅ ENABLED' : '❌ DISABLED'} for this chat.`);
  });

  bot.command('adddoc', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);

    let text = (ctx.match as string)?.trim();
    const reply = ctx.message?.reply_to_message;

    // Handle File Reply
    if (reply?.document) {
      await ctx.reply('📥 Processing document...');
      try {
        const file = await ctx.api.getFile(reply.document.file_id);
        const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            ...SCRAPER_CONFIG
        });
        
        let content = '';
        if (reply.document.file_name?.endsWith('.pdf')) {
            const data = await pdf(response.data);
            content = data.text;
        } else {
            content = Buffer.from(response.data).toString('utf-8');
        }

        await aiService.addDocument(content, { source: reply.document.file_name, type: 'file' });
        return ctx.reply(`✅ Document "${reply.document.file_name}" indexed!`);
      } catch (err) {
        return ctx.reply(`❌ Failed to process file: ${err}`);
      }
    }

    if (!text) {
      return ctx.reply('📝 Usage: `/adddoc <text>` or reply to a message/document with `/adddoc`', { parse_mode: 'Markdown' });
    }

    try {
      // Basic URL check
      if (text.startsWith('http')) {
          await ctx.reply('🌐 Scraping URL...');
          
          let targetUrl = text;
          // Special handling for Medium: Use RSS feed instead of HTML (bypasses 403)
          if (text.includes('medium.com')) {
              targetUrl = text.replace('medium.com/', 'medium.com/feed/');
              console.log(`Medium detected. Switching to Feed: ${targetUrl}`);
          }

          const res = await axios.get(targetUrl, SCRAPER_CONFIG);
          let content = res.data;

          if (targetUrl.includes('/feed/')) {
              // Parse simple XML from RSS feed
              const items = content.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/g) || [];
              content = items.map((i: string) => i.replace(/<[^>]+>/g, ' ')).join('\n\n');
              if (!content) {
                  // Fallback to description if encoded content missing
                  const desc = content.match(/<description>([\s\S]*?)<\/description>/g) || [];
                  content = desc.map((d: string) => d.replace(/<[^>]+>/g, ' ')).join('\n\n');
              }
          } else {
              const $ = cheerio.load(content);
              $('script, style, nav, footer').remove();
              content = $('body').text();
          }

          text = content.replace(/\s+/g, ' ').trim();
          
          if (text.length < 100) {
              return ctx.reply('⚠️ Scraped content is too short or empty. The site might be blocking us.');
          }
      }

      await aiService.addDocument(text, { added_by: ctx.from?.id, date: new Date().toISOString() });
      return ctx.reply('✅ Knowledge indexed successfully!');
    } catch (err) {
      return ctx.reply(`❌ Error adding document: ${err}`);
    }
  });

  bot.command('docstats', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    
    // This is a placeholder since HNSWLib doesn't easily expose count without loading
    return ctx.reply('📊 *Knowledge Base Status*\n\nIndex: `Local HNSWLib` (FAISS Equivalent)\nVectors: `Loaded`\nStatus: `Active`', { parse_mode: 'Markdown' });
  });

  bot.command('updatedocs', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    
    aiService.reloadFaq();
    return ctx.reply('✅ All docs reloaded and reindexed.');
  });

  bot.command('removedoc', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    
    const source = (ctx.match as string)?.trim();
    if (!source) return ctx.reply('🗑️ Usage: `/removedoc <filename_or_text>`', { parse_mode: 'Markdown' });

    await ctx.reply(`🗑️ Removing documents from source: "${source}"...`);
    try {
        await aiService.removeDocumentBySource(source);
        return ctx.reply(`✅ Documents from "${source}" removed successfully!`);
    } catch (err) {
        return ctx.reply(`❌ Error removing documents: ${err}`);
    }
  });

  bot.command('clearall', async (ctx: BotContext) => {
    if (!isOwner(ctx)) return denyAccess(ctx, true);
    
    await aiService.clearKnowledgeBase();
    return ctx.reply('🗑️ Knowledge base cleared.');
  });
};
