import { Bot } from 'grammy';
import { BotContext } from '../../types';
import { aiService, reinitializeAIService } from '../../core/ai';
import { isOwner, denyAccess } from '../../utils/permissions';

export default (bot: Bot<BotContext>) => {
  bot.command('aisetup', async (ctx: BotContext) => {
    try {
      // Security: owner only
      if (!isOwner(ctx)) {
        return denyAccess(ctx, true);
      }

      // Security: only allow in private chat
      if (ctx.chat && ctx.chat.type !== 'private') {
        return ctx.reply('🔒 This command only works in private chat with the bot (for security).');
      }

      const rawArgs = (ctx.match as string)?.trim() || '';
      const args    = rawArgs.split(' ').filter((a) => a.length > 0);

      if (!args[0]) {
        return ctx.reply(
          '🤖 *Universal AI API Setup*\n\n' +
          '*Anthropic / Generic API:*\n' +
          '`/aisetup key <api_key>`\n' +
          '`/aisetup model <model_name>`\n' +
          '`/aisetup url <base_url>` (Optional)\n\n' +
          '*AWS Bedrock:*\n' +
          '`/aisetup aws-key <access_key>`\n' +
          '`/aisetup aws-secret <secret_key>`\n' +
          '`/aisetup aws-region <region>`\n\n' +
          '*Control:*\n' +
          '`/aisetup test` | `/aisetup status`\n' +
          '`/aisetup reset` | `/aisetup faq` (Reload Knowledge)',
          { parse_mode: 'Markdown' },
        );
      }

      const command = args[0].toLowerCase();
      const value   = args.slice(1).join(' ');

      // ── AWS Commands ───────────────────────────────────────────────────────
      if (command === 'aws-key') {
        if (!value) return ctx.reply('❌ Provide AWS Access Key.');
        process.env.AWS_ACCESS_KEY = value;
        reinitializeAIService();
        return ctx.reply('✅ AWS Access Key set.');
      }

      if (command === 'aws-secret') {
        if (!value) return ctx.reply('❌ Provide AWS Secret Key.');
        process.env.AWS_SECRET_KEY = value;
        reinitializeAIService();
        return ctx.reply('✅ AWS Secret Key set.');
      }

      if (command === 'aws-region') {
        if (!value) return ctx.reply('❌ Provide AWS Region (e.g., us-east-1).');
        process.env.AWS_REGION = value;
        reinitializeAIService();
        return ctx.reply(`✅ AWS Region set to ${value}.`);
      }

      // ── url ────────────────────────────────────────────────────────────────
      if (command === 'url') {
        if (!value) {
          // Allow clearing URL
          process.env.AI_BASE_URL = '';
        } else {
          process.env.AI_BASE_URL = value;
        }
        reinitializeAIService();
        return ctx.reply(
          `✅ *Base URL set to:*\n\`${value || 'Default (OpenAI)'}\`\n\n` +
          '📝 To make permanent, add to `.env`:\n' +
          `\`AI_BASE_URL=${value}\``,
          { parse_mode: 'Markdown' },
        );
      }

      // ── key ────────────────────────────────────────────────────────────────
      if (command === 'key') {
        if (!value) {
          return ctx.reply('❌ Provide your API key:\n`/aisetup key gsk_...`', { parse_mode: 'Markdown' });
        }
        process.env.AI_API_KEY = value;
        reinitializeAIService();
        return ctx.reply(
          '✅ *API key set for this session*\n\n' +
          '📋 *Next steps:*\n' +
          '1. Test: `/aisetup test`\n' +
          '2. Chat: `/chat Hello!`\n\n' +
          '📝 To make permanent, add to `.env`:\n' +
          `\`AI_API_KEY=${value.slice(0, 10)}...\``,
          { parse_mode: 'Markdown' },
        );
      }

      // ── model ──────────────────────────────────────────────────────────────
      if (command === 'model') {
        if (!value) {
          return ctx.reply(
            '❌ Provide a model name:\n`/aisetup model llama3-70b-8192`',
            { parse_mode: 'Markdown' },
          );
        }
        process.env.AI_MODEL = value;
        reinitializeAIService();
        return ctx.reply(
          `✅ Model changed to \`${value}\`\n\n📝 To make permanent add to \`.env\`:\n\`AI_MODEL=${value}\``,
          { parse_mode: 'Markdown' },
        );
      }

      // ── status ─────────────────────────────────────────────────────────────
      if (command === 'status') {
        const hasKey = !!process.env.AI_API_KEY;
        const awsKey = process.env.AWS_ACCESS_KEY || '';
        const hasAws = awsKey && !awsKey.startsWith('your_') && (process.env.AWS_SECRET_KEY || '').length > 5;
        
        const url    = process.env.AI_BASE_URL || 'Default (Anthropic)';
        const model  = process.env.AI_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0';
        
        return ctx.reply(
          '🤖 *AI Configuration Status*\n\n' +
          `🔗 *Base URL:* \`${url}\`\n` +
          `🔑 *Anthropic Key:* ${hasKey ? '✅' : '❌'}\n` +
          `☁️ *AWS Bedrock:* ${hasAws ? '✅' : '❌'} (${process.env.AWS_REGION || 'us-east-1'})\n` +
          `🧠 *Model:* \`${model}\`\n\n` +
          `⚡ *Status:* ${ (hasKey || hasAws) ? '✅ Ready' : '⚠️ No valid keys configured'}\n` +
          '📝 _Note: Bot-side changes are temporary. Update .env to make permanent._',
          { parse_mode: 'Markdown' },
        );
      }

      // ── faq ────────────────────────────────────────────────────────────────
      if (command === 'faq') {
        aiService.reloadFaq();
        return ctx.reply('✅ FAQ knowledge base reloaded from faq_data.json');
      }

      // ── test ───────────────────────────────────────────────────────────────
      if (command === 'test') {
        const hasKey = !!process.env.AI_API_KEY;
        const hasAws = !!process.env.AWS_ACCESS_KEY && !!process.env.AWS_SECRET_KEY;

        if (!hasKey && !hasAws) {
          return ctx.reply('❌ Set an AI Key or AWS credentials first:\n`/aisetup key ...` or `/aisetup aws-key ...`', { parse_mode: 'Markdown' });
        }
        await ctx.replyWithChatAction('typing');
        try {
          const context  = { userId: 'test', platform: 'telegram' as const, messages: [] };
          const response = await aiService.chat(context, 'Reply with exactly: AI is working!', { saveContext: false });
          const model    = response.model || 'unknown';
          return ctx.reply(
            `✅ *API Test Passed*\n\n🧠 Model: \`${model}\`\n💬 Response: ${response.content}\n🔢 Provider: ${response.provider}`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          return ctx.reply(
            `❌ *API Test Failed*\n\`${String(err).slice(0, 300)}\`\n\nCheck your settings with \`/aisetup status\``,
            { parse_mode: 'Markdown' },
          );
        }
      }

      // ── reset ──────────────────────────────────────────────────────────────
      if (command === 'reset') {
        process.env.AI_API_KEY = '';
        process.env.AI_BASE_URL = '';
        reinitializeAIService();
        return ctx.reply(
          '✅ *API Configuration Removed*\n\n' +
          'The AI API key and Base URL have been cleared from this session.\n' +
          '⚠️ Don\'t forget to also remove them from your `.env` file if they are hardcoded there.',
          { parse_mode: 'Markdown' },
        );
      }

      return ctx.reply('❓ Unknown sub-command. Use `/aisetup` for help.');

    } catch (error) {
      console.error('aisetup error:', error);
      await ctx.reply('❌ An error occurred: ' + String(error).slice(0, 100));
    }
  });
};
