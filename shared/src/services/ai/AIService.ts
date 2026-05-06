import Anthropic from '@anthropic-ai/sdk';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Ollama } from 'ollama';
import { Redis } from 'ioredis';
import { Logger } from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { VectorStoreService } from './VectorStoreService';


export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: 'anthropic' | 'aws' | 'ollama';
  tokensUsed?: number;
  cost?: number;
  /** true when AI signalled it cannot answer and a human should follow up */
  isEscalation?: boolean;
}

export interface AIConfig {
  anthropicApiKey?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  ollamaHost?: string;
  /** Primary Claude model. Default: claude-sonnet-4-6 */
  defaultModel?: string;
  /** Ollama model used as fallback. Default: llama3.2:3b */
  fallbackModel?: string;
  maxTokens?: number;
  temperature?: number;
  /** Bot name shown in the system prompt */
  botName?: string;
  /** Absolute path to faq_data.json — auto-discovered if omitted */
  faqPath?: string;
  /** Telegram/Discord user ID to notify when escalation triggers */
  escalationUserId?: string;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

export interface ConversationContext {
  userId: string;
  chatId?: string;
  platform: 'discord' | 'telegram';
  messages: AIMessage[];
  systemPrompt?: string;
}


interface FaqEntry {
  q: string;
  a: string;
}

interface LogEntry {
  timestamp: number;
  userId: string;
  chatId?: string;
  platform: 'discord' | 'telegram';
  model: string;
  provider: 'anthropic' | 'aws' | 'ollama';
  tokensUsed: number;
  cost: number;
}

interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: { anthropic: number; aws: number; ollama: number };
  uniqueUsers: number;
}


const INJECTION_PHRASES: string[] = [
  'ignore previous instructions',
  'ignore all previous',
  'forget your instructions',
  'you are now',
  'act as if',
  'jailbreak',
  'reveal your system prompt',
  'what are your instructions',
];

const MAX_INPUT_LENGTH = 1000;


export class AIService {
  private anthropic?: Anthropic;
  private bedrock?: BedrockRuntimeClient;
  private ollama?: Ollama;
  private redis: Redis | any;
  private logger: Logger;
  private config: Required<AIConfig>;
  private faqEntries: FaqEntry[] = [];
  private cachedSystemPrompt?: string;
  private vectorStore?: VectorStoreService;

  constructor(config: AIConfig, redis: Redis | any, logger: Logger) {
    this.redis = redis;
    this.logger = logger;

    this.config = {
      anthropicApiKey:   config.anthropicApiKey   ?? '',
      awsAccessKey:      config.awsAccessKey      ?? '',
      awsSecretKey:      config.awsSecretKey      ?? '',
      awsRegion:         config.awsRegion         ?? 'us-east-1',
      ollamaHost:        config.ollamaHost        ?? 'http://localhost:11434',
      defaultModel:      config.defaultModel      ?? 'anthropic.claude-3-haiku-20240307-v1:0',
      fallbackModel:     config.fallbackModel     ?? 'llama3.2:3b',
      maxTokens:         config.maxTokens         ?? 2000,
      temperature:       config.temperature       ?? 0.7,
      botName:           config.botName           ?? 'SupportBot',
      faqPath:           config.faqPath           ?? '',
      escalationUserId:  config.escalationUserId  ?? '',
      rateLimit: config.rateLimit ?? { maxRequests: 20, windowMs: 3_600_000 },
    };

    // Initialize Vector Store if AWS keys are present
    const vsAwsKey = this.config.awsAccessKey;
    const vsAwsSecret = this.config.awsSecretKey;
    if (vsAwsKey && vsAwsSecret && !vsAwsKey.startsWith('your_')) {
        const storagePath = path.join(process.cwd(), 'storage', 'vectors');
        this.vectorStore = new VectorStoreService({
            accessKeyId: vsAwsKey,
            secretAccessKey: vsAwsSecret,
            region: this.config.awsRegion || 'us-east-1'
        }, storagePath);
        this.vectorStore.init().catch(err => this.logger.error('Vector Store Init Failed:', err));
    }

    this.loadFaqData();

    // Anthropic (primary)
    const key = this.config.anthropicApiKey;
    if (key && !key.startsWith('your_') && key.length > 10) {
      try {
        this.anthropic = new Anthropic({ apiKey: key });
        this.logger.info('Anthropic Claude AI initialised');
      } catch (err) {
        this.logger.error('Failed to initialise Anthropic:', err);
      }
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not configured — Claude AI disabled.');
    }

    // AWS Bedrock (secondary)
    const awsKey = this.config.awsAccessKey;
    const isPlaceholder = awsKey?.startsWith('your_');

    if (awsKey && !isPlaceholder && awsKey.length > 10) {
      try {
        this.bedrock = new BedrockRuntimeClient({
          region: this.config.awsRegion || 'us-east-1',
          credentials: {
            accessKeyId:     this.config.awsAccessKey,
            secretAccessKey: this.config.awsSecretKey,
          },
        });
        this.logger.info(`AWS Bedrock Runtime initialised (${this.config.awsRegion})`);
      } catch (err) {
        this.logger.error('Failed to initialise AWS Bedrock:', err);
      }
    } else {
      if (isPlaceholder) {
        this.logger.warn('AWS Credentials are still set to placeholders in .env — Bedrock AI disabled.');
      } else {
        this.logger.warn('AWS Credentials not configured — Bedrock AI disabled.');
      }
    }

    // Ollama (fallback)
    try {
      this.ollama = new Ollama({ host: this.config.ollamaHost });
      this.logger.info('Ollama fallback initialised');
    } catch (err) {
      this.logger.error('Failed to initialise Ollama:', err);
    }
  }


  private loadFaqData(): void {
    const candidates = [
      this.config.faqPath,
      path.join(process.cwd(), 'faq_data.json'),
      path.join(process.cwd(), '..', 'faq_data.json'),
      path.join(__dirname, '..', '..', '..', 'faq_data.json'),
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8');
          this.faqEntries = JSON.parse(raw) as FaqEntry[];
          this.cachedSystemPrompt = undefined; // invalidate cache
          this.logger.info(`FAQ loaded: ${this.faqEntries.length} entries from ${p}`);
          return;
        }
      } catch (err) {
        this.logger.warn(`Could not load FAQ from ${p}: ${err}`);
      }
    }

    this.logger.warn('faq_data.json not found — AI will answer without FAQ constraints');
  }

  /** Hot-reload FAQ without restarting the bot */
  reloadFaq(): void {
    this.loadFaqData();
  }

  async addDocument(text: string, metadata: any = {}): Promise<void> {
    if (!this.vectorStore) throw new Error('Vector store not initialized. Check AWS credentials.');
    await this.vectorStore.addDocuments(text, metadata);
    this.logger.info('Document added and indexed');
  }

  async removeDocumentBySource(sourceName: string): Promise<void> {
    if (this.vectorStore) await this.vectorStore.removeBySource(sourceName);
  }

  async clearKnowledgeBase(): Promise<void> {
    if (this.vectorStore) await this.vectorStore.clear();
  }

  getDocCount(): number {
    return this.vectorStore?.getDocCount() ?? 0;
  }



  private buildSystemPrompt(override?: string): string {
    if (override) return override;
    if (this.cachedSystemPrompt) return this.cachedSystemPrompt;

    const name = this.config.botName;

    const faqBlock = this.faqEntries.length > 0
      ? this.faqEntries.map((e) => `Q: ${e.q}\nA: ${e.a}`).join('\n\n')
      : null;

    // ── ElevenLabs-style six-block persona-first prompt ───────────────────────
    this.cachedSystemPrompt = [

      // Block 1 — Identity (persona, NOT constraint list)
      `# Identity`,
      `You are ${name}, Astarter's support assistant. You are friendly, sharp, and genuinely`,
      `helpful — the kind of expert who makes complex DeFi topics feel approachable.`,
      `You know Astarter's products, ecosystem, and community inside out.`,
      ``,

      // Block 2 — Environment
      `# Environment`,
      `You operate inside Astarter's Telegram community group. Users come here to learn`,
      `about Astarter, get help with the platform, and understand the Cardano DeFi ecosystem.`,
      `You have access to Astarter's knowledge base and FAQ. The retrieved context for each`,
      `query will be provided to you — treat it as your primary source of truth.`,
      ``,

      // Block 3 — Tone
      `# Tone`,
      `Be conversational and direct. Match the user's energy — casual when they're casual,`,
      `technical when they need depth. Keep responses concise (2–3 sentences unless a`,
      `detailed explanation genuinely helps).`,
      ``,
      `FORMATTING RULES — follow exactly, no exceptions:`,
      `  • Use <b>text</b> for bold (key terms, product names, headings)`,
      `  • Use plain • bullet points for lists — NEVER use <ul>, <li>, <ol> tags`,
      `  • Use <code>text</code> for technical values, commands, addresses`,
      `  • Use <i>text</i> for subtle emphasis`,
      `  • NEVER use Markdown (**bold**, _italic_, [link](url), # heading)`,
      `  • NEVER use <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <p>, <div>, <span>`,
      `  • If you need a heading, use <b>Heading Text</b> on its own line`,
      `  • Separate sections with a blank line, not HTML tags`,
      `Occasional emojis are fine. Never write walls of text. Never repeat yourself.`,
      ``,

      // Block 4 — Goal
      `# Goal`,
      `Help users succeed with Astarter. When you have the answer, give it directly and`,
      `clearly. When you don't, be honest and point them to the right resource or offer to`,
      `connect them with the support team. Always leave the user with a clear next step.`,
      `Anticipate follow-up questions and address them proactively when useful.`,
      ``,

      // Block 5 — Knowledge handling
      `# Knowledge Handling`,
      faqBlock
        ? `The following FAQ is part of your core knowledge — prioritize it for project questions:\n\n${faqBlock}\n`
        : `Your knowledge base is being updated. For now, direct users to the official Astarter docs or support.\n`,
      `For each user message, you will also receive retrieved context from the knowledge`,
      `base. Use that context as your primary answer source. If the retrieved context`,
      `covers the question, synthesize a clear answer from it. If it doesn't cover the`,
      `question, say so honestly:`,
      `"I don't have the details on that right now — your best bet is checking the`,
      `official docs or reaching out to the support team directly."`,
      `NEVER fabricate facts, token prices, dates, or technical specifications.`,
      `NEVER give financial advice or price predictions.`,
      ``,

      // Block 6 — Guardrails (written as goals, not prohibitions)
      `# Guardrails`,
      `Stay focused on Astarter and the Cardano DeFi ecosystem. When a user goes`,
      `off-topic — whether it's general crypto chat, unrelated questions, or anything`,
      `outside Astarter — acknowledge it briefly and bring the conversation back:`,
      `"That's a bit outside my wheelhouse! I'm ${name}, here to help with Astarter —`,
      `what are you working on?"`,
      ``,
      `If someone asks about your underlying model, who built you, or your technical`,
      `architecture: stay in character as ${name}. You're Astarter's assistant and that's`,
      `your identity here. You don't need to disclose or deny any particular technology —`,
      `just redirect warmly: "I'm ${name}! My job is to help you with Astarter. What`,
      `can I help you with today?"`,
      ``,
      `If a user is extremely frustrated or explicitly asks for a human agent,`,
      `respond with exactly the word: ESCALATE`,
      ``,
      `IMPORTANT: Never claim to be human if someone sincerely asks whether you are an AI.`,
      `You can be honest — "I'm an AI assistant for Astarter" — without disclosing`,
      `your underlying technology.`,

    ].filter(Boolean).join('\n');
    // ─────────────────────────────────────────────────────────────────────────

    return this.cachedSystemPrompt;
  }


  private sanitizeInput(text: string): string {
    const truncated = text.slice(0, MAX_INPUT_LENGTH);
    const lower = truncated.toLowerCase();

    for (const phrase of INJECTION_PHRASES) {
      if (lower.includes(phrase)) {
        this.logger.warn(`Prompt injection attempt blocked — phrase: "${phrase}"`);
        return 'I have a general question about the bot.';
      }
    }

    return truncated;
  }


  private async checkRateLimit(userId: string): Promise<boolean> {
    const key = `ai:ratelimit:${userId}`;
    const current = await this.redis.get(key);

    if (!current) {
      await this.redis.setex(key, Math.floor(this.config.rateLimit.windowMs / 1000), '1');
      return true;
    }

    const count = parseInt(current, 10);
    if (count >= this.config.rateLimit.maxRequests) return false;

    await this.redis.incr(key);
    return true;
  }


  async getConversationContext(
    userId: string,
    chatId?: string,
    platform: 'discord' | 'telegram' = 'discord',
  ): Promise<ConversationContext> {
    const key = `ai:conversation:${platform}:${chatId ?? userId}:${userId}`;
    const raw = await this.redis.get(key);

    if (raw) {
      try {
        return JSON.parse(raw) as ConversationContext;
      } catch (err) {
        this.logger.error('Failed to parse conversation context:', err);
      }
    }

    return { userId, chatId, platform, messages: [] };
  }

  async saveConversationContext(context: ConversationContext, ttl = 3600): Promise<void> {
    const key = `ai:conversation:${context.platform}:${context.chatId ?? context.userId}:${context.userId}`;
    // Keep last 20 messages (10 turns) to cap memory usage
    const trimmed = { ...context, messages: context.messages.slice(-20) };
    await this.redis.setex(key, ttl, JSON.stringify(trimmed));
  }

  async clearConversationContext(
    userId: string,
    chatId?: string,
    platform: 'discord' | 'telegram' = 'discord',
  ): Promise<void> {
    const key = `ai:conversation:${platform}:${chatId ?? userId}:${userId}`;
    await this.redis.del(key);
  }


  private async generateWithAnthropic(
    messages: AIMessage[],
    systemPrompt: string,
    model?: string,
  ): Promise<AIResponse> {
    if (!this.anthropic) throw new Error('Anthropic not initialised');

    const modelToUse = model ?? this.config.defaultModel;

    // Anthropic messages array must not contain 'system' role entries
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await this.anthropic.messages.create({
      model:       modelToUse,
      max_tokens:  this.config.maxTokens,
      temperature: this.config.temperature,
      system:      systemPrompt,
      messages:    chatMessages,
    });

    const block = response.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    if (!text) throw new Error('Empty response from Anthropic');

    return {
      content:    text,
      model:      modelToUse,
      provider:   'anthropic',
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }


  private async generateWithAWS(
    messages: AIMessage[],
    systemPrompt: string,
    model?: string,
  ): Promise<AIResponse> {
    if (!this.bedrock) throw new Error('AWS Bedrock not initialised');

    let modelToUse = model ?? this.config.defaultModel;
    // Default to Claude 3 Haiku if a non-Bedrock model name is passed
    if (!modelToUse.includes('.')) {
        modelToUse = 'anthropic.claude-3-haiku-20240307-v1:0';
    }

    this.logger.info(`Generating with AWS Bedrock (${modelToUse})...`);

    try {
        const command = new ConverseCommand({
          modelId: modelToUse,
          system: [{ text: systemPrompt }],
          messages: messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: [{ text: m.content }]
          })),
          inferenceConfig: {
            maxTokens: this.config.maxTokens || 1024,
            temperature: this.config.temperature || 0.7,
          }
        });

        const response = await this.bedrock.send(command);
        const stopReason = response.stopReason;
        const contentBlocks = response.output?.message?.content || [];
        
        // Find the first block that has text
        const textBlock = contentBlocks.find(b => b.text !== undefined);
        const text = textBlock?.text?.trim();

        if (!text) {
          this.logger.error(`AWS Bedrock returned no text. StopReason: ${stopReason}. Full response:`, JSON.stringify(response, null, 2));
          throw new Error(`AWS Bedrock returned no text. StopReason: ${stopReason}`);
        }

        return {
          content:  text,
          model:    modelToUse,
          provider: 'aws',
        };
    } catch (err: any) {
        this.logger.error(`AWS Bedrock Error: ${err.message}`);
        throw err;
    }
  }


  private async generateWithOllama(messages: AIMessage[], model?: string): Promise<AIResponse> {
    if (!this.ollama) throw new Error('Ollama not initialised');

    const modelToUse = model ?? this.config.fallbackModel;

    const response = await this.ollama.chat({
      model: modelToUse,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      options:  { temperature: this.config.temperature, num_predict: this.config.maxTokens },
    });

    const text = response.message?.content?.trim();
    if (!text) throw new Error('Empty response from Ollama');

    return { content: text, model: modelToUse, provider: 'ollama' };
  }


  async chat(
    context: ConversationContext,
    userMessage: string,
    options?: {
      model?: string;
      useOllamaOnly?: boolean;
      saveContext?: boolean;
      systemPrompt?: string;
    },
  ): Promise<AIResponse> {
    // 1. Rate limit
    const allowed = await this.checkRateLimit(context.userId);
    if (!allowed) throw new Error('Rate limit exceeded. Please try again later.');

    // 2. Sanitise input
    const safeMessage = this.sanitizeInput(userMessage);

    // 3. Build message history
    const messages: AIMessage[] = [
      ...context.messages,
      { role: 'user', content: safeMessage },
    ];

    // 4. RAG: Search for relevant context
    // Strip "[Context: User is @x]\n" prefix so it doesn't pollute the embedding query
    const ragQuery = safeMessage.replace(/^\[Context:[^\]]*\]\n?/i, '').trim();
    let ragContext = '';
    if (this.vectorStore && ragQuery.length > 0) {
        const hits = await this.vectorStore.search(ragQuery, 3);
        if (hits.length > 0) {
            ragContext = hits.map(h => h.pageContent).join('\n---\n');
            this.logger.info(`RAG: found ${hits.length} chunk(s) for query: "${ragQuery.slice(0, 60)}"`);
        } else {
            this.logger.info(`RAG: no chunks matched for query: "${ragQuery.slice(0, 60)}"`);
        }
    }

    // 5. System prompt
    const basePrompt = this.buildSystemPrompt(
      options?.systemPrompt ?? context.systemPrompt,
    );

    const dynamicPrompt = [
        basePrompt,
        `\n# Dynamic Context (Retrieved from Knowledge Base)`,
        ragContext || "No specific information found for this query in the knowledge base.",
        `\n# Critical Instructions`,
        `1. Detect the user's language and reply in the SAME language.`,
        `2. If you are replying in a group, mention the user with @username if available.`,
        `3. Use the "Dynamic Context" above as your primary source of truth.`,
        `4. If the answer is not in the context or FAQ, say: "I don't have that information in my knowledge base."`,
        `5. Never hallucinate or make up project details.`,
    ].join('\n');

    // 6. Call AI provider
    let response: AIResponse | undefined;

    try {
      if (!options?.useOllamaOnly && this.anthropic) {
        response = await this.generateWithAnthropic(messages, dynamicPrompt, options?.model);
      } else if (!options?.useOllamaOnly && this.bedrock) {
        response = await this.generateWithAWS(messages, dynamicPrompt, options?.model);
      } else if (this.ollama) {
        const fullMessages: AIMessage[] = [
          { role: 'system', content: dynamicPrompt },
          ...messages,
        ];
        response = await this.generateWithOllama(fullMessages, options?.model);
      } else {
        throw new Error('No AI provider available. Set ANTHROPIC_API_KEY or AWS credentials in .env.');
      }
    } catch (err) {
      // Fallback Chain: Anthropic -> AWS -> Ollama
      if (!options?.useOllamaOnly && this.bedrock && (!response || response.provider !== 'aws')) {
          this.logger.warn('Primary provider failed — falling back to AWS Bedrock');
          try {
            response = await this.generateWithAWS(messages, dynamicPrompt, options?.model);
          } catch (awsErr) {
            this.logger.error('AWS Bedrock fallback also failed:', awsErr);
            // continue to Ollama
          }
      }

      if (!response && this.ollama) {
        this.logger.warn('Falling back to Ollama');
        try {
          const fullMessages: AIMessage[] = [
            { role: 'system', content: dynamicPrompt },
            ...messages,
          ];
          response = await this.generateWithOllama(fullMessages, options?.model);

        } catch (fallbackErr) {
          this.logger.error('All AI providers failed or none are configured.');
          throw new Error('All AI providers failed. Check your API keys and region settings.');
        }
      } else if (!response) {
        throw err;
      }
    }

    // 7. Hallucination Check (Self-Reflect)
    const verificationPrompt = `
    Context: ${ragContext}
    AI Response: ${response.content}
    
    Task: Does the AI Response contain any facts, dates, or technical details NOT present in the Context? 
    Reply with only "YES" if it has hallucinations, or "NO" if it is safe and grounded.
    `;

    try {
        const check = await this.generateWithAWS([{ role: 'user', content: verificationPrompt }], "You are a factual verification judge.", this.config.defaultModel);
        if (check.content.toUpperCase().includes('YES')) {
            this.logger.warn('Hallucination detected! Regenerating with stricter constraints...');
            response = await this.chat(context, userMessage, { ...options, systemPrompt: dynamicPrompt + "\nCRITICAL: Your previous answer was flagged as incorrect. Stick ONLY to the context." });
        }
    } catch (err) {
        this.logger.error('Hallucination check failed, skipping safety check:', err);
    }

    // 8. Handle escalation signal
    if (response.content === 'ESCALATE') {
      response.isEscalation = true;
      response.content =
        "I apologize, but I am specifically trained to assist with project-related inquiries. I cannot answer that question as it falls outside my current scope. Please contact a human moderator for further assistance.";
    }

    // 7. Persist context
    if (options?.saveContext !== false) {
      const updated: ConversationContext = {
        ...context,
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
        ],
      };
      await this.saveConversationContext(updated);
    }

    // 8. Log usage
    await this.logUsage(context, response);

    return response;
  }


  private async logUsage(context: ConversationContext, response: AIResponse): Promise<void> {
    const logKey = `ai:usage:${context.platform}:${new Date().toISOString().split('T')[0]}`;
    const entry: LogEntry = {
      timestamp:  Date.now(),
      userId:     context.userId,
      chatId:     context.chatId,
      platform:   context.platform,
      model:      response.model,
      provider:   response.provider,
      tokensUsed: response.tokensUsed ?? 0,
      cost:       response.cost ?? 0,
    };
    await this.redis.lpush(logKey, JSON.stringify(entry));
    await this.redis.expire(logKey, 30 * 24 * 60 * 60); // 30-day retention
  }

  async getUsageStats(platform?: 'discord' | 'telegram', date?: string): Promise<UsageStats> {
    const dateStr = date ?? new Date().toISOString().split('T')[0];
    const pattern = platform ? `ai:usage:${platform}:${dateStr}` : `ai:usage:*:${dateStr}`;
    let logs: LogEntry[] = [];

    if (pattern.includes('*')) {
      const keys: string[] = await this.redis.keys(pattern);
      for (const k of keys) {
        const entries: string[] = await this.redis.lrange(k, 0, -1);
        logs.push(...entries.map((e) => JSON.parse(e) as LogEntry));
      }
    } else {
      const entries: string[] = await this.redis.lrange(pattern, 0, -1);
      logs = entries.map((e) => JSON.parse(e) as LogEntry);
    }

    return {
      totalRequests: logs.length,
      totalTokens:   logs.reduce((s, l) => s + (l.tokensUsed ?? 0), 0),
      totalCost:     logs.reduce((s, l) => s + (l.cost ?? 0), 0),
      byProvider: {
        anthropic: logs.filter((l) => l.provider === 'anthropic').length,
        aws:       logs.filter((l) => l.provider === 'aws').length,
        ollama:    logs.filter((l) => l.provider === 'ollama').length,
      },
      uniqueUsers: new Set(logs.map((l) => l.userId)).size,
    };
  }


  async listAvailableModels(): Promise<{ anthropic: string[]; aws: string[]; ollama: string[] }> {
    const result = { anthropic: [] as string[], aws: [] as string[], ollama: [] as string[] };

    if (this.anthropic) {
      result.anthropic = [
        'claude-3-5-sonnet-20241022',
        'claude-3-haiku-20240307',
      ];
    }

    if (this.bedrock) {
      result.aws = [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'anthropic.claude-3-sonnet-20240229-v1:0',
      ];
    }

    if (this.ollama) {
      try {
        const { models } = await this.ollama.list();
        result.ollama = models.map((m) => m.name);
      } catch (err) {
        this.logger.error('Failed to list Ollama models:', err);
      }
    }

    return result;
  }

  async testConnection(): Promise<{ anthropic: boolean; aws: boolean; ollama: boolean }> {
    const result = { anthropic: false, aws: false, ollama: false };

    if (this.anthropic) {
      try {
        await this.generateWithAnthropic(
          [{ role: 'user', content: 'Reply with one word: ok' }],
          'You are a test assistant.',
          this.config.defaultModel,
        );
        result.anthropic = true;
      } catch (err) {
        this.logger.error('Anthropic connection test failed:', err);
      }
    }

    if (this.bedrock) {
      try {
        await this.generateWithAWS(
          [{ role: 'user', content: 'Reply with one word: ok' }],
          'You are a test assistant.',
        );
        result.aws = true;
      } catch (err) {
        this.logger.error('AWS Bedrock connection test failed:', err);
      }
    }

    if (this.ollama) {
      try {
        await this.ollama.list();
        result.ollama = true;
      } catch (err) {
        this.logger.error('Ollama connection test failed:', err);
      }
    }

    return result;
  }
}

export default AIService;
