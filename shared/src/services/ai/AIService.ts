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
      defaultModel:      config.defaultModel      ?? 'amazon.nova-lite-v1:0',
      fallbackModel:     config.fallbackModel     ?? 'llama3.2:3b',
      maxTokens:         config.maxTokens         ?? 2000,
      temperature:       config.temperature       ?? 0.7,
      botName:           config.botName           ?? 'TENET',
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

    // ── TRINITY persona — ElevenLabs-style, natural knowledge blending ────────
    const OFFICIAL_LINKS = `
OFFICIAL ASTARTER LINKS (always use these exact URLs, never others):
• Website: https://www.astarter.io
• Telegram Community: https://t.me/AstarterDefiHubOfficial
• Telegram Announcements: https://t.me/Astarteranncmnt
• Twitter/X: https://x.com/AstarterDefiHub
• Discord: https://discord.gg/XXDEjFPrgR
• Medium: https://medium.com/@AstarterDefiHub
• Linktree (all links): https://linktr.ee/Astarter
• Email: contact@astarter.ai
`.trim();

    this.cachedSystemPrompt = `# Who You Are
You are ${name}, Astarter's support assistant living inside the community Telegram group. You're not a bot that fires off data dumps — you're the friendly, knowledgeable person on the team who genuinely wants to help people understand and get excited about Astarter. You talk like a real human support rep in a chat window: warm, clear, confident, and conversational.

Your personality in one sentence: you make Web4, AI agents, and DePIN feel approachable and exciting without drowning people in jargon — and you always leave people feeling helped, not just answered.

# Your Environment
Astarter is Infrastructure for the Autonomous AI Economy — a Web4/AI/DePIN project combining decentralized AI agent networks (CORE layer), on-chain execution, and ABox node hardware. This is the community Telegram group. People ask about ABox nodes, CORE agent layer, node tiers and pricing, tokenomics, the roadmap, how to earn, Mulan Points, and general Astarter questions.

Important project note: Astarter is now a Web4/AI/DePIN infrastructure project. It is NO LONGER a Cardano DeFi launchpad. If you see context about "Astarter Launchpad, IDO, Astarter Swap, Money Market, Cardano ADA pools" — that is old and outdated. Ignore it.

# How You Talk
Think of yourself as a support rep in a live chat — not a FAQ page.

• Acknowledge the person first when it fits naturally. Something like "Good question!" or "Happy to help with that!" — but only when it feels genuine, not as a robotic prefix.
• Answer what was asked, then offer to go deeper. One question = one clear answer + an optional "Want me to go into more detail on X?"
• When someone is confused or frustrated, show you get it: "I can see why that's unclear — let me explain it simply."
• When you're unsure what they mean: ask! Don't guess. "I want to make sure I answer the right thing — did you mean X or Y?"
• End responses with a natural follow-up when it makes sense: "Anything else you'd like to know?" or "Want details on the node tiers?"

# How You Format Responses
You're in Telegram — keep it clean and readable.

• <b>Bold</b> key terms and names
• <code>code</code> for values, numbers, addresses
• <i>italics</i> for soft emphasis
• Bullet lists: plain • on new lines — max 4 bullets per response
• Keep total response length to 4–6 lines. Short is always better.
• NEVER use Markdown (**text**, _text_, # heading, [link](url))
• NEVER output HTML tags like <ul>, <li>, <ol>, <h1>–<h6>, <p>, <div>

When a user says "yes", "tell me more", or "go on" — give ONE next piece of info (2–3 sentences), not everything you know.

# What You Know
${faqBlock ? `The information below is your knowledge base — you know all of this. But never dump it all at once. Share only what's directly relevant to the question, in a conversational way:\n\n${faqBlock}\n\nAdditional context relevant to the current question may appear at the end of this prompt. Blend it naturally into your answer — don't cite it or list it mechanically. If it contains old product info (launchpad, DEX, Money Market, Cardano IDO), ignore it and rely on the FAQ above.` : `Your knowledge base is being set up. For project-specific questions you don't know, direct users to the official Astarter channels.`}

# When You Don't Know Something
Be honest and human about it — don't make things up, and don't give a cold "I don't have that information."

Say something like: "Hmm, I don't have that detail confirmed yet — best to watch the announcements channel for the latest!" And only add a link if the user asked for one, or if your answer is genuinely "not confirmed yet."

NEVER invent: token prices, dates, percentages, wallet addresses, technical specs, partnerships, blockchain integrations, or revenue numbers. If it's not in your knowledge base or the context below, it doesn't exist yet. Never give financial or investment advice.

# How You Handle Unclear Messages
If a message is vague, misspelled, or could mean multiple things — always ask for clarification. Do NOT guess and answer the wrong thing.

Example: someone writes "bous" — you could say: "Just to make sure I help you correctly — did you mean ABox (the hardware node), or something else?"

# Conversation Examples

User: "what is ABox"
You: "ABox is Astarter's plug-and-play AI node device — you run it at home and it connects you to the network so you can earn revenue sharing. Want to know about the different node tiers and pricing?"

User: "what blockchains will Astarter support"
You: "That hasn't been officially confirmed yet! Keep an eye on the announcements channel — that's where all the official news drops first."

User: "tell me about bous"
You: "Just to make sure I help you with the right thing — did you mean ABox, or were you asking about something else?"

User: "yes tell me more"
You: [Give ONE new piece of info, 2–3 sentences — not a full data dump]

User: [Angry, frustrated, asks for a real human]
You: ESCALATE

# Guardrails
• Stay on Astarter, Web4, AI agents, and DePIN. Off-topic? Gently redirect: "That's a bit outside my area — I'm ${name}, Astarter's support assistant. What can I help you with Astarter-wise?"
• If asked about your tech stack, who built you, or what AI you run on: stay in character. "I'm ${name}! Here to help with everything Astarter-related. What do you need?"
• If sincerely asked whether you're human: you can say you're an AI assistant without naming any specific technology.
• Current user is identified at the start of their message. Do NOT repeat their name back to them. Names in the # Context section are other participants in old messages — not the person you're talking to now.

# Links
${OFFICIAL_LINKS}

Only share links when: (a) the user explicitly asks for a link/resource, or (b) the exact detail isn't confirmed yet — even if you gave a general timeframe (e.g. "Q2-Q3 2026") but the precise date/info isn't set — always add https://t.me/Astarteranncmnt so they know where to watch. NEVER add links when the answer is fully and specifically confirmed. ONLY use URLs from the list above.

# Language
Detect the language from the user's message and reply 100% in that language. Arabic, Turkish, Russian, Spanish, French, Chinese, Hindi, Indonesian, Portuguese, Vietnamese, Korean, Japanese, German, Italian — all supported. If ambiguous, use English. Each conversation is independent — never let one user's language affect another.`;
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


  /**
   * Sanitise a message list for Bedrock's ConverseCommand requirements:
   *  - Remove system-role and empty-content messages
   *  - Ensure strict user/assistant alternation (merge or drop consecutive same-role entries)
   *  - Must start with 'user' role
   */
  private sanitizeMessagesForBedrock(messages: AIMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    // 1. Keep only user/assistant with non-empty content
    const filtered = messages
      .filter(m => m.role !== 'system' && m.content && m.content.trim().length > 0)
      .map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.content }));

    if (filtered.length === 0) return filtered;

    // 2. Merge consecutive same-role entries (join with newline)
    const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of filtered) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += '\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    // 3. Must start with 'user'
    while (merged.length > 0 && merged[0].role !== 'user') {
      merged.shift();
    }

    return merged;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async generateWithAWS(
    messages: AIMessage[],
    systemPrompt: string,
    model?: string,
  ): Promise<AIResponse> {
    if (!this.bedrock) throw new Error('AWS Bedrock not initialised');

    let modelToUse = model ?? this.config.defaultModel ?? 'openai.gpt-oss-20b-1:0';

    // AWS Bedrock cross-region inference: only Anthropic models need a regional prefix
    // (eu./us./ap.). OpenAI, Meta, Mistral etc. use their model ID as-is.
    if (modelToUse.startsWith('anthropic.')) {
      const region = this.config.awsRegion ?? 'us-east-1';
      const bareModel = modelToUse.replace(/^(eu|us|ap)\./, '');
      if (region.startsWith('eu-')) {
        modelToUse = `eu.${bareModel}`;
      } else if (region.startsWith('ap-')) {
        modelToUse = `ap.${bareModel}`;
      } else {
        modelToUse = `us.${bareModel}`;
      }
    }

    // Sanitise messages before sending — Bedrock requires strict alternation
    const sanitized = this.sanitizeMessagesForBedrock(messages);
    if (sanitized.length === 0) {
      throw new Error('No valid messages after sanitisation');
    }

    const RETRYABLE = new Set([
      'ThrottlingException',
      'ServiceUnavailableException',
      'InternalServerException',
      'ModelTimeoutException',
    ]);
    const MAX_ATTEMPTS = 4;
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        this.logger.info(`AWS Bedrock attempt ${attempt}/${MAX_ATTEMPTS} (${modelToUse})`);

        const command = new ConverseCommand({
          modelId: modelToUse,
          system: [{ text: systemPrompt }],
          messages: sanitized.map(m => ({
            role: m.role,
            content: [{ text: m.content }]
          })),
          inferenceConfig: {
            maxTokens: this.config.maxTokens || 800,
            // Low temperature (0.1) = factual, grounded answers, far less hallucination.
            // topP (0.5) = restricts to top 50% likely tokens, prevents creative drift.
            temperature: 0.1,
            topP: 0.5,
          }
        });

        const response = await this.bedrock.send(command);
        const stopReason = response.stopReason;
        const contentBlocks = response.output?.message?.content || [];
        const textBlock = contentBlocks.find((b: any) => b.text !== undefined);
        const text = textBlock?.text?.trim();

        if (!text) {
          this.logger.error(`AWS Bedrock no text. StopReason: ${stopReason}`);
          throw new Error(`AWS Bedrock returned no text. StopReason: ${stopReason}`);
        }

        return { content: text, model: modelToUse, provider: 'aws' };

      } catch (err: any) {
        lastErr = err;
        const code: string = err?.name ?? err?.code ?? err?.errorCode ?? '';
        const isRetryable = RETRYABLE.has(code) ||
            (err?.message ?? '').toLowerCase().includes('throttl') ||
            (err?.message ?? '').toLowerCase().includes('too many requests');

        if (isRetryable && attempt < MAX_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 600; // 1.2s, 2.4s, 4.8s
          this.logger.warn(`AWS Bedrock throttled (${code}) — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
          await this.sleep(delay);
          continue;
        }
        this.logger.error(`AWS Bedrock failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);
        throw err;
      }
    }

    throw lastErr ?? new Error('AWS Bedrock: max retries exceeded');
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
    const cleanCurrent = safeMessage.replace(/^\[Context:[^\]]*\]\n?/i, '').trim();

    // For follow-up questions, enrich the RAG query with the last assistant reply
    // so short follow-ups like "what about fees?" find the right context
    const lastAssistant = context.messages
        .filter(m => m.role === 'assistant')
        .slice(-1)[0]?.content ?? '';
    const lastUser = context.messages
        .filter(m => m.role === 'user')
        .slice(-1)[0]?.content
        ?.replace(/^\[Context:[^\]]*\]\n?/i, '').trim() ?? '';

    // If this looks like a short follow-up (<60 chars), prepend previous turn for richer search
    const isFollowUp = cleanCurrent.length < 60 && lastUser.length > 0;
    const ragQuery = isFollowUp
        ? `${lastUser} ${cleanCurrent}`.slice(0, 400)
        : cleanCurrent;

    let ragContext = '';
    if (this.vectorStore && ragQuery.length > 0) {
        // ── Two-pass RAG: deck chunks first (authoritative), history only as supplement ──
        // Root cause of old-data answers: 929 telegram_history chunks vs 9 deck chunks means
        // a flat search always fills slots with old Cardano DeFi chat messages. Fix: search
        // each type separately, always show deck knowledge first, only include history when
        // deck has fewer than 2 hits (i.e. question is community/sentiment, not product).

        // Confidence threshold: only use chunks with cosine similarity ≥ 0.45
        // Below this score the chunk is weakly related and more likely to mislead than help.
        const MIN_SCORE = 0.45;

        // Pass 1: current project knowledge
        const deckRaw = await this.vectorStore.searchFiltered(ragQuery, 3, ['astarter_deck', 'manual']);
        const deckHits = deckRaw.filter(h => h.score >= MIN_SCORE);

        // Pass 2: community chat — only when deck is sparse
        const histRaw = deckHits.length < 2
            ? await this.vectorStore.searchFiltered(ragQuery, 2, ['telegram_history'])
            : [];
        const histHits = histRaw.filter(h => h.score >= MIN_SCORE);

        if (deckRaw.length !== deckHits.length || histRaw.length !== histHits.length) {
            this.logger.info(
                `RAG confidence filter: deck ${deckRaw.length}→${deckHits.length}, ` +
                `hist ${histRaw.length}→${histHits.length} (threshold ${MIN_SCORE})`
            );
        }

        const parts: string[] = [];
        if (deckHits.length > 0) {
            parts.push(
                '## Current Project Knowledge (authoritative — use this)\n' +
                deckHits.map(h => h.pageContent).join('\n---\n')
            );
        }
        if (histHits.length > 0) {
            parts.push(
                '## Community Chat (supplementary — DISCARD any Cardano DeFi / launchpad / Astarter Swap / Money Market content, that is outdated)\n' +
                histHits.map(h => h.pageContent).join('\n---\n')
            );
        }

        if (parts.length > 0) {
            ragContext = parts.join('\n\n');
            this.logger.info(
                `RAG: ${deckHits.length} deck + ${histHits.length} history for: "${ragQuery.slice(0, 60)}"` +
                (isFollowUp ? ' [follow-up]' : '')
            );
        } else {
            this.logger.info(`RAG: no chunks matched for: "${ragQuery.slice(0, 60)}"`);
        }
    }

    // 5. System prompt
    const basePrompt = this.buildSystemPrompt(
      options?.systemPrompt ?? context.systemPrompt,
    );

    const dynamicPrompt = ragContext
        ? `${basePrompt}\n\n---\n# IMPORTANT CONTEXT — You MUST use the information below to answer the user's question. If the answer is in this context, DO NOT say "I'm not aware" or "hasn't been announced". Answer based on what you see here:\n\n${ragContext}`
        : basePrompt;

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

    // 7. Handle escalation signal
    if (response.content === 'ESCALATE') {
      response.isEscalation = true;
      response.content =
        "I apologize, but I am specifically trained to assist with project-related inquiries. I cannot answer that question as it falls outside my current scope. Please contact a human moderator for further assistance.";
    }

    // 8. Persist context
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

    // 9. Log usage
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
