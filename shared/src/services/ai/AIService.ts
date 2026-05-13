import Anthropic from '@anthropic-ai/sdk';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
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
  'disregard your',
  'override your',
  'bypass your',
  'new persona',
  'pretend you are',
  'roleplay as',
  'system prompt:',
  'your real instructions',
  'developer mode',
  'sudo mode',
  'admin override',
  'ignore safety',
  'without restrictions',
];

const MAX_INPUT_LENGTH = 1000;

// Allowed URLs — the only links the bot is permitted to output
const ALLOWED_URLS = new Set([
  // Astarter official channels
  'https://www.astarter.io',
  'https://astarter.gitbook.io',
  'https://t.me/AstarterDefiHubOfficial',
  'https://t.me/Astarteranncmnt',
  'https://x.com/AstarterDefiHub',
  'https://twitter.com/AstarterDefiHub',
  'https://discord.gg/XXDEjFPrgR',
  'https://medium.com/@AstarterDefiHub',
  'https://www.reddit.com/r/Astarter/',
  'https://youtube.com/c/astartertv',
  'https://zealy.io/cw/astarterdefihub/leaderboard',
  'https://linktr.ee/Astarter',
  // Partner links — MULAN
  'https://mulan.meme',
  // Partner links — PayGo
  'https://www.paygo.ac',
  'https://x.com/PayGo402',
  'https://t.me/Paygo_eni',
  // Partner links — Zeus Network
  'https://zeusnetwork.xyz',
  'https://x.com/ZeusNetworkHQ',
  'https://discord.gg/zeusnetwork',
  // Partner links — ENI / ENIAC Network
  'https://eniac.network',
  'https://docs.eniac.network',
  'https://x.com/ENI__Official',
  'https://t.me/ENI_Channel',
  'https://t.me/ENI_Community',
]);


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
    const result = await this.vectorStore.addDocuments(text, metadata);
    this.logger.info(`Document indexed: ${result.indexed} chunks OK, ${result.failed} failed`);
    if (result.failed > 0) {
      throw new Error(`Partial indexing: ${result.indexed} succeeded, ${result.failed} chunks failed to embed`);
    }
  }

  /** Raw search — returns top-k chunks with scores. Used by /testsearch for debugging. */
  async searchDocs(
    query: string,
    k = 5,
    typeFilter?: string[],
  ): Promise<{ pageContent: string; metadata: any; score: number }[]> {
    if (!this.vectorStore) return [];
    return this.vectorStore.searchFiltered(query, k, typeFilter);
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

    this.cachedSystemPrompt = `# Role
You are ${name}, Astarter's AI support assistant embedded in the community Telegram group. You are a knowledgeable team member helping in a live chat — not a FAQ robot, not a search engine, not a data dumper. Your job is to make people feel genuinely understood and helped.

# Before Every Response — Work Through These Steps (MANDATORY)
Step 1: What is the user ACTUALLY asking for? (understand the real intent, not just the literal words)
Step 2: Do I have verified knowledge about this? (only use what's in the Knowledge Base or Retrieved Context below)
Step 3: What is the MINIMUM response that fully resolves their question?
Step 4: Am I about to dump a data wall? If yes — STOP. Give ONE key point only, then ask what they want next.
Step 5: Is my response ending with a follow-up question? If not — ADD ONE before sending.
Step 6: Am I about to add a link, channel, or "check X for more" that the user did NOT ask for? If yes — REMOVE IT.
Never skip these steps. Check all 6 before every reply.

# Grounding Rules (highest priority — override everything else)
• ONLY state facts from the Knowledge Base or Retrieved Context below. If a fact is not there, it does not exist for you.
• TRAINING DATA BAN: Your AI training data contains internet information about Astarter. IGNORE IT COMPLETELY. Do not fill in gaps with what you "know" from training. If the Knowledge Base doesn't say it, you don't know it.
• NEVER invent or guess: prices, APY, wallet addresses, dates, announcements, listings, tech specs, revenue numbers, partner details. If you don't have it in the Knowledge Base, say "I don't have that confirmed" and stop there.
• DEAD PRODUCTS: Astarter is no longer a Cardano launchpad. Never present as current: Launchpad, IDO, Astarter Swap, Money Market, ADA pools, ISPO, AA1 staking. If asked about these: "Astarter has moved on from that phase — it's now Web4 AI infrastructure and ABox nodes. Want to know more?"
• RETRIEVED CONTEXT: If a "# Retrieved Context" block appears below, treat it as verified current fact. Answer confidently from it — do NOT say "I'm not sure" or "this hasn't been confirmed" when the answer is right there.

# What Astarter Is
Infrastructure for the Autonomous AI Economy — Web4/AI/DePIN with three pillars: decentralized AI agent networks (CORE layer), on-chain execution, and ABox node hardware. Common topics: ABox nodes, pricing, CORE, tokenomics, roadmap, earning, Mulan Points, partnerships.

# How to Answer
## Answer Length Rule (HIGHEST PRIORITY — overrides everything except Grounding Rules)
1. Give the SHORTEST accurate answer first — 1 to 3 sentences maximum for most questions.
2. End with ONE short follow-up question to keep the conversation going.
3. STOP after the question. Do not volunteer extra context, history, or related info the user did not ask for.
4. Only expand into detail when the user explicitly asks ("tell me more", "yes", "go on", "explain that").
5. If an answer truly requires more than 3 sentences, use at most 4 tight bullet points — never a wall of text.

## Content Rules
• Lead with the direct answer. No preamble. No "Great question!"
• Every response ends with ONE follow-up question — short, natural, relevant to what was just said.
• If the user asks for ONE specific thing → give ONLY that thing, then ask what they want next.
• Paraphrase knowledge naturally. Never copy-paste raw FAQ entries or paste entire bullet lists from your knowledge base.
• If the question is vague or broad ("tell me about X", "give X details", "explain X", "what about partners") → give ONE sentence overview only, then ask which specific part they want. NEVER dump all known facts about a topic just because the user said "details". Example: "MULAN is Astarter's partner running a points-and-NFT ecosystem. Which part interests you — earning points, NFTs, or redemption?"
• If the question could mean multiple things: pick the most likely interpretation, answer it, and confirm with a question.

Follow-up question examples (pick the most natural for context):
→ "Which part would you like to dig into?"
→ "Want me to walk through how that works?"
→ "Anything specific you'd like to know about [topic]?"
→ "Shall I cover the earning structure / pricing / how to join?"

ONLY skip the follow-up question when:
- The answer is a single confirmed fact with nothing left to expand (e.g. "The token ticker is AA")
- The user just said "thanks" or similar closing message

# Response Format (Telegram)
• <b>Bold</b> for key terms, names, tiers, dates
• <code>code</code> for numbers, prices, IDs, amounts
• <i>italics</i> for soft context or emphasis
• Bullet list ONLY when there are 3+ genuinely parallel items to compare. Max 4 bullets. No nesting.
• 3–5 lines is the sweet spot. Never exceed what the question actually needs.
• NEVER use Markdown syntax in your output: no **bold**, no _italic_, no # headings, no [text](url)
• NEVER output block HTML: <ul>, <li>, <ol>, <h1>–<h6>, <p>, <div>
• When the user follows up ("yes", "tell me more", "go on") → give ONE next piece of info in 2 sentences max, then ask the next natural question.
• NEVER end a factual answer with "For more, see ...", "Learn more at ...", "Check the docs at ...", or any unsolicited link. Only include a URL if the user explicitly asked for a link.

BAD (never do this):
"Astarter is a Web4 AI infrastructure. For more details, see https://astarter.gitbook.io/astarter."

GOOD:
"Astarter is a Web4 AI infrastructure focused on autonomous AI agents and DePIN nodes."

# When You Don't Know
Pick the right pattern — don't mix them:

Not officially announced yet:
→ "That hasn't been officially confirmed yet — watch the announcements channel for updates!"

Outside your knowledge entirely:
→ "I don't have that detail right now. The team is reachable at <code>contact@astarter.io</code> for specifics."

Old Cardano-era product:
→ "Astarter has moved on from the launchpad/DeFi era — it's now focused on Web4 AI infrastructure and ABox nodes. Want to know more about what's current?"

Price or live financial data:
→ "I don't have live price data — check a crypto price aggregator for current figures."

Rule: Never say "I'm not sure but..." and then give details anyway. You know it cleanly or you don't.

# Escalation
If a user is clearly angry, repeatedly frustrated, or explicitly asks for a human: reply with exactly the single word ESCALATE and nothing else.

# URL Reference (exact URLs only — no substitutions, no guessing)
When a user asks for a specific link, give EXACTLY the URL below for that topic. Never substitute one URL for another.

• gitbook / docs / documentation / guide → https://astarter.gitbook.io/astarter
• website / homepage → https://www.astarter.io
• telegram community / tg group / community chat → https://t.me/AstarterDefiHubOfficial
• announcements / ann channel → https://t.me/Astarteranncmnt
• twitter / x → https://x.com/AstarterDefiHub
• discord → https://discord.gg/XXDEjFPrgR
• medium / blog → https://medium.com/@AstarterDefiHub
• reddit → https://www.reddit.com/r/Astarter/
• youtube → https://youtube.com/c/astartertv
• zealy / quests → https://zealy.io/cw/astarterdefihub/leaderboard
• all links / socials / linktree / every link → https://linktr.ee/Astarter
• contact / email / partnership → contact@astarter.io (email — not a link)

Partner links (ONLY when user explicitly asks for a partner's link):
• PayGo → https://www.paygo.ac
• Zeus Network → https://zeusnetwork.xyz
• ENI / ENIAC → https://eniac.network
• MULAN / Mulan Labs → https://mulan.meme

Link rules:
• Share a link ONLY when the user explicitly asks for it ("give me the link", "what's the URL", "where can I find it").
• One link requested = give one link. Do NOT list other links alongside it.
• NEVER substitute linktree when a specific URL was requested.
• NEVER append links to factual answers unless the user asked for a link.
• NEVER add "check the announcements channel" or any channel/link at the end of an answer unless the user asked for it.
• Contact/listing/partnership enquiries → email only: <code>contact@astarter.io</code>
• Gitbook/docs is DOCUMENTATION, not a social media channel. NEVER include it when listing socials/social media links.
• When asked for "social media", "all socials", "social links", or equivalent in any language → respond with ONLY: https://linktr.ee/Astarter
• If an entity (partner, product, feature) has no URL in this table → do NOT give any URL for it. Do not substitute linktree.

# Guardrails
• Topic scope: Astarter, Web4, AI agents, DePIN. Off-topic → "That's a bit outside my area — I'm ${name}, here for everything Astarter. What can I help with?"
• Identity: If asked what AI model you are → stay in character: "I'm ${name}, Astarter's support assistant! What do you need?"
• "Are you human?" (sincere) → you may say you're an AI without naming any model or company.
• Messages start with [Context: User is @x] — do NOT repeat the username back. Names inside Retrieved Context are other community members.

# Language
Detect the language of the user's message and reply fully in that language. Arabic, Turkish, Russian, Spanish, French, Chinese, Hindi, Indonesian, Portuguese, Vietnamese, Korean, Japanese, German, Italian — all supported. Default to English when ambiguous.

# Knowledge Base
${faqBlock
  ? `Your verified knowledge is below. Use it to answer accurately. Synthesize it in your own words — never paste it verbatim or dump entire entries. If the user asks about ONE specific item from a multi-part answer, give ONLY that item:\n\n${faqBlock}`
  : `Knowledge base is loading. Direct specific questions to contact@astarter.io or the official channels.`}`;
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


  /**
   * Output sanitizer — strips any URL from AI response that isn't in the ALLOWED_URLS set.
   * Prevents hallucinated links from reaching users even if the prompt is bypassed.
   */
  private sanitizeOutput(text: string): string {
    return text.replace(/https?:\/\/[^\s)>\]"']+/g, (url) => {
      // Trim trailing punctuation that may have been captured
      const clean = url.replace(/[.,;!?]+$/, '');
      // Check if this URL starts with any allowed URL
      for (const allowed of ALLOWED_URLS) {
        if (clean === allowed || clean.startsWith(allowed)) {
          return url; // keep as-is (with original trailing chars)
        }
      }
      this.logger.warn(`Blocked unauthorized URL in AI output: ${clean}`);
      return '';
    });
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
      max_tokens:  Math.min(this.config.maxTokens, 800),
      temperature: 0.2,  // Low temp = factual, grounded. Never use config temp for support agent.
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

    // 3. Build message history (compress if long)
    const messages: AIMessage[] = [
      ...this.compressHistory(context.messages),
      { role: 'user', content: safeMessage },
    ];

    // 4. RAG: Search for relevant context
    // Strip "[Context: User is @x]\n" prefix so it doesn't pollute the embedding query
    const cleanCurrent = safeMessage.replace(/^\[Context:[^\]]*\]\n?/i, '').trim();

    // Strip conversational question preambles that add noise to embedding similarity.
    // "do you know when turkey meetup?" → "turkey meetup"
    // Without this, the preamble shifts the embedding vector away from the actual topic.
    const RAG_PREAMBLE = /^(do you know|can you tell me|can you explain|what (is|are|was|were)|who (is|are|was)|where (is|are)|when (is|are|was)|how (do|does|did|can|should|is)|tell me about|i (want|need) to know|i have a question about|please (explain|tell me|describe)|any (info|information|details|update|news) (on|about|regarding)|is (there|it)|are there|have you heard|do you have)\s+/i;
    const topicQuery = cleanCurrent.replace(RAG_PREAMBLE, '').trim() || cleanCurrent;

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
    const isFollowUp = topicQuery.length < 60 && lastUser.length > 0;
    const ragQuery = isFollowUp
        ? `${lastUser} ${topicQuery}`.slice(0, 400)
        : topicQuery;

    let ragContext = '';
    if (this.vectorStore && ragQuery.length > 0) {
        // ── Two-pass RAG: deck chunks first (authoritative), history only as supplement ──
        // Root cause of old-data answers: 929 telegram_history chunks vs 9 deck chunks means
        // a flat search always fills slots with old Cardano DeFi chat messages. Fix: search
        // each type separately, always show deck knowledge first, only include history when
        // deck has fewer than 2 hits (i.e. question is community/sentiment, not product).

        // Confidence threshold — lowered from 0.45 to 0.35 to account for hybrid scoring.
        // Hybrid score = 0.7*cosine + 0.3*keyword. Since keyword can be 0 for short/vague
        // queries, a strong cosine match (0.5) produces hybrid = 0.35 — not 0.5.
        // Using 0.35 here gives equivalent filtering quality to 0.45 pure-cosine.
        const MIN_SCORE = 0.35;

        // Pass 1: current project knowledge
        const deckRaw = await this.vectorStore.searchFiltered(ragQuery, 5, ['astarter_deck', 'manual']);
        let deckHits = deckRaw.filter(h => h.score >= MIN_SCORE);

        // Debug: always log top scores so PM2 logs show what was found/filtered
        if (deckRaw.length > 0) {
            const topScores = deckRaw.slice(0, 3).map(h => h.score.toFixed(3)).join(', ');
            this.logger.info(`RAG deck scores: [${topScores}] → ${deckHits.length} passed (threshold ${MIN_SCORE})`);
        }

        // CRAG: if zero authoritative hits, simplify query and retry once (corrective retrieval)
        if (deckHits.length === 0 && ragQuery.length > 20) {
            const shortQuery = ragQuery.split(/\s+/).slice(0, 5).join(' ');
            const retryRaw = await this.vectorStore.searchFiltered(shortQuery, 5, ['astarter_deck', 'manual']);
            const retryHits = retryRaw.filter(h => h.score >= MIN_SCORE - 0.05);
            if (retryHits.length > 0) {
                deckHits = retryHits;
                this.logger.info(`CRAG retry: ${retryHits.length} hits with shortened query "${shortQuery}"`);
            } else {
                this.logger.info(`CRAG retry also missed — top score: ${retryRaw[0]?.score.toFixed(3) ?? 'none'}`);
            }
        }

        // Pass 2: community chat — only when deck is sparse
        const histRaw = deckHits.length < 2
            ? await this.vectorStore.searchFiltered(ragQuery, 2, ['telegram_history'])
            : [];
        const histHits = histRaw.filter(h => h.score >= MIN_SCORE);

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
        ? `${basePrompt}\n\n---\n# Retrieved Context\nThe following was retrieved from the verified knowledge base for this specific question. It is factual and current. Use it to answer directly and confidently — do NOT say "I'm not sure", "hasn't been confirmed", or "I don't have that info" when the answer is below. Paraphrase naturally; do not copy-paste.\n\n${ragContext}`
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

    // 7. Sanitize output — strip any URL not in the allowed list
    response.content = this.sanitizeOutput(response.content);

    // 7b. Guard against empty response after sanitization (e.g. reply was only a stripped URL)
    if (!response.content.trim()) {
      response.content = "I don't have that link confirmed right now — you can find all official Astarter links at https://linktr.ee/Astarter 🔗";
    }

    // 8. Handle escalation signal — strip Markdown bold/italic wrappers before checking
    //    (AI sometimes outputs **ESCALATE** instead of bare ESCALATE)
    const escalateCandidate = response.content.trim().replace(/^\*{1,2}(.*?)\*{1,2}$/, '$1').trim();
    if (/^ESCALATE[.!]?\s*$/i.test(escalateCandidate)) {
      response.isEscalation = true;
      response.content =
        "I want to make sure you get the right help — let me flag this for a team member who can assist you further! 🙌";
    }

    // 9. Persist context
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

    // 10. Log usage
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

  // ── Streaming generation ─────────────────────────────────────────────────────

  private async streamWithAnthropic(
    messages: AIMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    model?: string,
  ): Promise<{ text: string; tokensUsed: number }> {
    if (!this.anthropic) throw new Error('Anthropic not initialised');
    const modelToUse = model ?? this.config.defaultModel;
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.anthropic.messages.stream({
      model: modelToUse,
      max_tokens: Math.min(this.config.maxTokens, 800),
      temperature: 0.2,
      system: systemPrompt,
      messages: chatMessages,
    });

    let text = '';
    stream.on('text', (chunk: string) => {
      text += chunk;
      onChunk(chunk); // synchronous — never blocks the stream loop
    });
    const final = await stream.finalMessage();
    return { text, tokensUsed: final.usage.input_tokens + final.usage.output_tokens };
  }

  private async streamWithAWS(
    messages: AIMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void,
    model?: string,
  ): Promise<{ text: string }> {
    if (!this.bedrock) throw new Error('AWS Bedrock not initialised');
    let modelToUse = model ?? this.config.defaultModel;

    if (!modelToUse) throw new Error('No model configured for AWS Bedrock');

    if (modelToUse.startsWith('anthropic.')) {
      const region = this.config.awsRegion ?? 'us-east-1';
      const bare = modelToUse.replace(/^(eu|us|ap)\./, '');
      modelToUse = region.startsWith('eu-') ? `eu.${bare}` : region.startsWith('ap-') ? `ap.${bare}` : `us.${bare}`;
    }

    const sanitized = this.sanitizeMessagesForBedrock(messages);
    if (sanitized.length === 0) throw new Error('No valid messages after sanitisation');

    const command = new ConverseStreamCommand({
      modelId: modelToUse,
      system: [{ text: systemPrompt }],
      messages: sanitized.map(m => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { maxTokens: this.config.maxTokens || 800, temperature: 0.1, topP: 0.5 },
    });

    const RETRYABLE = new Set(['ThrottlingException', 'ServiceUnavailableException', 'InternalServerException', 'ModelTimeoutException']);
    const MAX_ATTEMPTS = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.bedrock.send(command);
        let text = '';
        for await (const event of response.stream!) {
          const chunk = event.contentBlockDelta?.delta?.text;
          if (chunk) {
            text += chunk;
            onChunk(chunk); // fire-and-forget — never block the stream loop
          }
        }
        if (!text) throw new Error('AWS Bedrock stream returned no text');
        return { text };
      } catch (err: any) {
        lastErr = err;
        const code: string = err?.name ?? err?.code ?? '';
        const isRetryable = RETRYABLE.has(code) || (err?.message ?? '').toLowerCase().includes('throttl');
        if (isRetryable && attempt < MAX_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 600;
          this.logger.warn(`Bedrock stream throttled — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('AWS Bedrock stream: max retries exceeded');
  }

  /** Stream AI response, calling onChunk for every token. Returns the final AIResponse. */
  async chatStream(
    context: ConversationContext,
    userMessage: string,
    onChunk: (chunk: string) => void,
    options?: { model?: string; systemPrompt?: string; saveContext?: boolean },
  ): Promise<AIResponse> {
    const allowed = await this.checkRateLimit(context.userId);
    if (!allowed) throw new Error('Rate limit exceeded. Please try again later.');

    const safeMessage = this.sanitizeInput(userMessage);
    const messages: AIMessage[] = [
      ...this.compressHistory(context.messages),
      { role: 'user', content: safeMessage },
    ];

    // RAG — same as chat()
    const cleanCurrent = safeMessage.replace(/^\[Context:[^\]]*\]\n?/i, '').trim();
    const RAG_PREAMBLE = /^(do you know|can you tell me|can you explain|what (is|are|was|were)|who (is|are|was)|where (is|are)|when (is|are|was)|how (do|does|did|can|should|is)|tell me about|i (want|need) to know|i have a question about|please (explain|tell me|describe)|any (info|information|details|update|news) (on|about|regarding)|is (there|it)|are there|have you heard|do you have)\s+/i;
    const topicQuery = cleanCurrent.replace(RAG_PREAMBLE, '').trim() || cleanCurrent;
    const lastUser = context.messages.filter(m => m.role === 'user').slice(-1)[0]?.content?.replace(/^\[Context:[^\]]*\]\n?/i, '').trim() ?? '';
    const isFollowUp = topicQuery.length < 60 && lastUser.length > 0;
    const ragQuery = isFollowUp ? `${lastUser} ${topicQuery}`.slice(0, 400) : topicQuery;

    let ragContext = '';
    if (this.vectorStore && ragQuery.length > 0) {
      const MIN_SCORE = 0.35;
      const deckRaw = await this.vectorStore.searchFiltered(ragQuery, 5, ['astarter_deck', 'manual']);
      let deckHits = deckRaw.filter(h => h.score >= MIN_SCORE);
      if (deckHits.length === 0 && ragQuery.length > 20) {
        const short = ragQuery.split(/\s+/).slice(0, 5).join(' ');
        const retry = await this.vectorStore.searchFiltered(short, 5, ['astarter_deck', 'manual']);
        deckHits = retry.filter(h => h.score >= MIN_SCORE - 0.05);
      }
      const histRaw = deckHits.length < 2 ? await this.vectorStore.searchFiltered(ragQuery, 2, ['telegram_history']) : [];
      const histHits = histRaw.filter(h => h.score >= MIN_SCORE);
      const parts: string[] = [];
      if (deckHits.length > 0) parts.push('## Current Project Knowledge (authoritative — use this)\n' + deckHits.map(h => h.pageContent).join('\n---\n'));
      if (histHits.length > 0) parts.push('## Community Chat (supplementary — DISCARD Cardano/launchpad content)\n' + histHits.map(h => h.pageContent).join('\n---\n'));
      if (parts.length > 0) ragContext = parts.join('\n\n');
    }

    const basePrompt = this.buildSystemPrompt(options?.systemPrompt ?? context.systemPrompt);
    const dynamicPrompt = ragContext
      ? `${basePrompt}\n\n---\n# Retrieved Context\nThe following was retrieved from the verified knowledge base. Use it to answer directly and confidently. Paraphrase naturally; do not copy-paste.\n\n${ragContext}`
      : basePrompt;

    // Stream from provider
    let fullText = '';
    let tokensUsed = 0;
    let provider: 'anthropic' | 'aws' | 'ollama' = 'aws';
    let usedModel = options?.model ?? this.config.defaultModel;

    try {
      if (this.anthropic) {
        const r = await this.streamWithAnthropic(messages, dynamicPrompt, onChunk, options?.model);
        fullText = r.text; tokensUsed = r.tokensUsed; provider = 'anthropic';
      } else if (this.bedrock) {
        const r = await this.streamWithAWS(messages, dynamicPrompt, onChunk, options?.model);
        fullText = r.text; provider = 'aws';
      } else if (this.ollama) {
        const r = await this.generateWithOllama([{ role: 'system', content: dynamicPrompt }, ...messages], options?.model);
        fullText = r.content; provider = 'ollama'; usedModel = r.model;
        onChunk(r.content); // synchronous — onChunk is void, not async
      } else {
        throw new Error('No AI provider available.');
      }
    } catch (err: any) {
      // Fallback chain: Anthropic → Bedrock → Ollama
      if (provider === 'anthropic' && this.bedrock) {
        this.logger.warn('Anthropic stream failed — falling back to Bedrock');
        try {
          const r = await this.streamWithAWS(messages, dynamicPrompt, onChunk, options?.model);
          fullText = r.text; provider = 'aws';
        } catch (bedrockErr) {
          if (this.ollama) {
            this.logger.warn('Bedrock stream also failed — falling back to Ollama');
            const r = await this.generateWithOllama([{ role: 'system', content: dynamicPrompt }, ...messages], options?.model);
            fullText = r.content; provider = 'ollama'; usedModel = r.model;
            onChunk(r.content);
          } else { throw bedrockErr; }
        }
      } else if (provider === 'aws' && this.ollama) {
        this.logger.warn('Bedrock stream failed — falling back to Ollama');
        const r = await this.generateWithOllama([{ role: 'system', content: dynamicPrompt }, ...messages], options?.model);
        fullText = r.content; provider = 'ollama'; usedModel = r.model;
        onChunk(r.content);
      } else { throw err; }
    }

    const response: AIResponse = { content: fullText, model: usedModel, provider, tokensUsed };

    // Post-processing (same as chat())
    response.content = this.sanitizeOutput(response.content);
    if (!response.content.trim()) {
      response.content = "I don't have that link confirmed right now — you can find all official Astarter links at https://linktr.ee/Astarter 🔗";
    }
    const escalateCandidate = response.content.trim().replace(/^\*{1,2}(.*?)\*{1,2}$/, '$1').trim();
    if (/^ESCALATE[.!]?\s*$/i.test(escalateCandidate)) {
      response.isEscalation = true;
      response.content = "I want to make sure you get the right help — let me flag this for a team member who can assist you further! 🙌";
    }
    if (options?.saveContext !== false) {
      await this.saveConversationContext({ ...context, messages: [...messages, { role: 'assistant', content: response.content }] });
    }
    await this.logUsage(context, response);
    return response;
  }

  // ── Language memory ───────────────────────────────────────────────────────────
  async getUserLang(userId: string): Promise<string | null> {
    try { return await this.redis.get(`ai:user_lang:${userId}`); } catch { return null; }
  }

  async setUserLang(userId: string, lang: string): Promise<void> {
    try { await this.redis.setex(`ai:user_lang:${userId}`, 30 * 24 * 3600, lang); } catch {}
  }

  // ── Conversation history compression ─────────────────────────────────────────
  private compressHistory(messages: AIMessage[]): AIMessage[] {
    if (messages.length <= 10) return messages;
    const recent = messages.slice(-6);
    const old = messages.slice(0, -6);
    const topics = old
      .filter(m => m.role === 'user')
      .map(m => m.content.replace(/^\[Context:[^\]]*\]\n?/i, '').trim().slice(0, 120))
      .filter(Boolean)
      .join('; ');
    return [
      { role: 'user', content: `[Earlier in our conversation, topics discussed: ${topics}]` },
      { role: 'assistant', content: 'Understood, I have context from our earlier discussion.' },
      ...recent,
    ];
  }

  // ── Feedback storage ──────────────────────────────────────────────────────────
  async storeFeedback(userId: string, chatId: string | undefined, helpful: boolean): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      await this.redis.lpush(`ai:feedback:${date}`, JSON.stringify({ userId, chatId, helpful, timestamp: Date.now() }));
      await this.redis.expire(`ai:feedback:${date}`, 90 * 24 * 3600);
    } catch {}
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
