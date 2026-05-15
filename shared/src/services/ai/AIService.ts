import Anthropic from '@anthropic-ai/sdk';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
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
  provider: 'anthropic' | 'aws';
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
  /** Primary model. Default: amazon.nova-lite-v1:0 */
  defaultModel?: string;
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
  provider: 'anthropic' | 'aws';
  tokensUsed: number;
  cost: number;
}

interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: { anthropic: number; aws: number };
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

const INTENT_KEYWORDS: Record<string, string[]> = {
  project:      ['astarter', 'depin', 'web4', 'abox', 'core agent', 'architecture', 'use case', 'flywheel'],
  nodes:        ['node', 'pioneer', 'alliance', 'abox', 'slot', 'tier', 'earn', 'revenue'],
  token:        [' aa ', 'token', 'tokenomics', 'tge', 'supply', 'vesting', 'emission', 'airdrop', 'allocation'],
  mulan:        ['mulan', 'point', 'nft', 'star', 'referral', 'bnb', 'redeem'],
  partnerships: ['partner', 'paygo', 'zeus', 'eni', 'eniac', 'zbtc', 'collaboration'],
  roadmap:      ['roadmap', 'timeline', 'launch', 'mainnet', 'q2', 'q3', '2026', 'phase', 'milestone'],
  team:         ['team', 'investor', 'okx', 'emurgo', 'advisor', 'founder', 'backed'],
  developers:   ['developer', 'sdk', 'api', 'framework', 'build', 'grant'],
  links:        ['link', 'website', 'telegram', 'twitter', 'discord', 'medium', 'gitbook', 'social'],
};

// Intent-specific expert knowledge blocks injected into the dynamic prompt (Node 5 equivalent)
const INTENT_EXPERT_BLOCKS: Record<string, string> = {
  nodes: `## ABox Node Expert Knowledge
Node tiers — LITE ($500 | 1,333 AA | 12,000 slots) · PRO ($1,000 | 2,900 AA | 4,137 slots) · MAX ($3,000 | 10,500 AA | 1,142 slots). Total: 17,279 slots. All tiers include revenue sharing + ABox presale whitelist.
Earning: 10% USDT direct referral per invite · 10% Global Board Revenue (NFT mining + DPOS + ecosystem) · 20% of new nodes' daily funds by weight to all holders.
Revenue streams: AI execution fees, compute rewards, marketplace share, DEX fee share, prediction market fees. Earning begins at mainnet (Q2–Q3 2026).
Be honest about risks: TGE not confirmed, tokens not liquid yet.`,

  token: `## AA Token Expert Knowledge
Total supply: 1,000,000,000. Type: Utility + Governance.
Emission: 250,000 AA/day at launch, −10% every 6 months (deflationary).
Allocation: Ecosystem/Community 42% · Staking Mining 38% · Market Cap Management 10% · R&D 5% · Node Airdrop 4% · Community Incentives 1%.
Vesting: Team/investors — 1-year cliff + 4-year linear. TGE: Q2–Q3 2026 target, exact date NOT confirmed. AA price NOT officially published.`,

  mulan: `## MULAN Expert Knowledge
Entry: 0.005 BNB (~$3) → 5,000 Mulan Points. Referral: Exchange ASTARTER + refer 1 address → 5,000 points.
NFT Star daily earning: 1-STAR 1,298 pts/day · 2-STAR 2,900 · 3-STAR 16,000 · 4-STAR 75,000.
Redemption (choose ONE for ALL points): (1) 30% AA token pool · (2) 30% Binance-listed token pool · (3) Independent exchange listing.
CRITICAL: The 30% is the size of the token POOL reserved for MULAN holders — NOT a conversion rate for individual points. Correct any user who says "30% of my points convert".
Node Revenue Tiers: $100→10% · $500→25% · $1,000→50% trading fee revenue share. Senior Partner: $3,000 → top-level partner + MULAN node worth $1,000.`,

  partnerships: `## Partnerships Expert Knowledge
5 active partners: MULAN Labs · PayGo · Zeus Network · ENI/ENIAC · UXLINK.
MULAN Labs (May 2026): Referral/traffic platform. MULAN point holders get AA airdrops + NFT rewards + node fee sharing. https://mulan.meme
PayGo (April 2026): AI-native x402 payment protocol — AI agents pay each other autonomously. https://www.paygo.ac
Zeus Network (April 2026): Bitcoin liquidity via zBTC (1:1 BTC-pegged), cross-chain BTC into Astarter. https://zeusnetwork.xyz
ENI/ENIAC Network (April 2026): Enterprise modular L1, cross-chain DeFi + co-incubation. https://eniac.network
UXLINK (May 2026): Leading Web3 social platform — connects global users, communities and builders. Partnership goal: integrate Astarter's AI-native infrastructure with UXLINK's social ecosystem to accelerate Web3 participation, autonomous coordination and on-chain growth. https://x.com/UXLINKofficial`,

  roadmap: `## Roadmap Expert Knowledge
2025 Q3–Q4 (COMPLETE): ABox presale, testnet, AI Agents early access.
2026 Q1–Q2 (IN PROGRESS): Pre-TGE tokenomics, partnerships (Zeus/ENI/PayGo/MULAN), ABox Node Plan + subscription live.
2026 Q2–Q3 (UPCOMING): Mainnet + TGE, AI DEX/Prediction/Data markets, developer API, Grant Program.
2026 Q4: Agent App Store, EVM expansion, second node wave. 2027+: Agent-to-agent execution, Web4 full autonomy.
TGE date is NOT officially confirmed — roadmap target only.`,

  team: `## Team & Investors Expert Knowledge
Community-driven project — no single owner publicly disclosed.
Lead investors: OKX Ventures, EMURGO. Strategic: Adaverse, MH Ventures, Avatar Capital, 316VC, CRT Capital, Megala Ventures.
Advisors: Sergio Sanchez (Head of Product EMURGO/Yoroi) · John O'Connor (Director African Ops IOHK/Cardano) · Darren Camas (CEO IPOR Labs).`,

  developers: `## Developer Resources Expert Knowledge
AI Agents Framework: Open-source, compatible with LangChain/AutoGPT. LIVE at mainnet.
Developer API/Docs: Full integration docs — coming Q2–Q3 2026 at mainnet.
Astarter Grant Program: Ecosystem grants for AI agent builders — expected Q2–Q3 2026.
Developer community: Discord #developers https://discord.gg/XXDEjFPrgR`,
};

const NEGATIVE_SIGNALS = [
  'angry', 'frustrated', 'terrible', 'awful', 'ridiculous', 'scam', 'fraud',
  'useless', 'worst', 'hate', 'stupid', 'disgusting', 'horrible', 'broken',
  'pathetic', 'waste', 'worthless', 'disaster', 'rubbish', 'trash',
];

// Allowed URLs — the only links the bot is permitted to output
const ALLOWED_URLS = new Set([
  // Astarter official channels
  'https://app.astarter.io',
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
  // Partner links — UXLINK
  'https://x.com/UXLINKofficial',
  'https://uxlink.io',
]);


export class AIService {
  private anthropic?: Anthropic;
  private bedrock?: BedrockRuntimeClient;
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
      defaultModel:      config.defaultModel      ?? 'amazon.nova-lite-v1:0',
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
          requestHandler: new NodeHttpHandler({ requestTimeout: 20000, connectionTimeout: 5000 }),
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
You are ${name}, Astarter's AI support assistant embedded in the community Telegram group. You are a knowledgeable teammate helping in a live chat — not a FAQ robot, not a search engine, not a data dumper. Your job is to make people feel genuinely understood and helped.

# Personality & Tone (live chat — keep this across every turn)
• Be warm, collaborative, and quietly supportive — a knowledgeable colleague beside the user, not a helpdesk script.
• Live chat tone: short, natural, human. No memo voice, no preambles, no walls of text, no repetitive restatement.
• Brief first-person language is natural when it fits: "Good news — that's still open!", "Honestly I don't have that confirmed yet", "That's a great one to watch for in the announcements channel."
• Show appropriate warmth: if someone sounds excited, match it briefly. If confused, be reassuring. If frustrated, acknowledge it plainly before answering.
• Occasional emoji are fine when they fit naturally, especially for warmth — keep them sparse.
• Never theatrical, melodramatic, robotic, or overly formal. Never say "Great question!" or "Certainly!".
• Keep the same personality every single turn — never suddenly shift from warm and casual to stiff and formal.

# Before Every Response — Check These (MANDATORY)
Step 1: What is the user ACTUALLY asking for? (intent, not just literal words)
Step 2: Do I have verified knowledge about this? (Knowledge Base or Retrieved Context only)
Step 3: What is the MINIMUM response that fully answers them?
Step 4: Am I about to dump a data wall? If yes — STOP. Give ONE key point, then ask what they want next.
Step 5: Does my response end with a follow-up question? If not — ADD ONE.
Step 6: Am I adding a link or "check X" the user did NOT ask for? If yes — REMOVE IT.
Never skip these steps.

# Grounding Rules (highest priority — override everything else)
• ONLY state facts from the Knowledge Base or Retrieved Context below. If a fact is not there, it does not exist for you.
• TRAINING DATA BAN: Your AI training data contains internet information about Astarter. IGNORE IT COMPLETELY. Do not fill in gaps with what you "know" from training. If the Knowledge Base doesn't say it, you don't know it.
• NEVER invent or guess: prices, APY, wallet addresses, dates, announcements, listings, tech specs, revenue numbers, partner details. If you don't have it in the Knowledge Base, say you don't have that confirmed and stop there.
• DEAD PRODUCTS: Astarter is no longer a Cardano launchpad. Never present as current: Launchpad, IDO, Astarter Swap, Money Market, ADA pools, ISPO, AA1 staking. If asked about these: "Astarter has moved on from that phase — it's now Web4 AI infrastructure and ABox nodes. Want to know more?"
• RETRIEVED CONTEXT: If a "# Retrieved Context" block appears below, treat it as verified current fact. Answer confidently from it — do NOT say "I'm not sure" or "this hasn't been confirmed" when the answer is right there.

## NEVER FABRICATE — Hard-blocked topics (say "not confirmed" for ALL of these, no exceptions)
These are questions users ask constantly where the answer does NOT exist in the Knowledge Base. Never guess, estimate, or extrapolate an answer:

| Topic | What to say |
|-------|-------------|
| AA token price / listing price | "The AA token price hasn't been officially published yet — keep an eye on the announcements channel when it drops." |
| Exact TGE / launch date | "The exact date hasn't been announced yet — mainnet is targeted for Q2–Q3 2026. Watch the announcements channel for the official date." |
| Which exchanges will list AA | "Not confirmed yet — watch the announcements channel when it's announced." |
| Node daily/monthly earnings (exact $) | "Earnings depend on network activity — exact amounts aren't published yet." |
| Staking APY / yield % | "No APY figure has been officially confirmed." |
| How to buy/purchase a node (step-by-step) | "For purchase details, visit app.astarter.io or ask in the community." |
| Founder / CEO / team identity | "The team hasn't been publicly disclosed." |
| KYC requirements | "Not confirmed in my knowledge base — check official channels." |
| When airdrop tokens will arrive | "Airdrop distribution timing hasn't been officially confirmed." |
| Can I sell / transfer my node | "Not confirmed in my knowledge base." |
| Specific wallet addresses | Never provide any wallet address under any circumstances. |

If a user asks about any of the above and pushes for an estimate: "I really don't have a confirmed figure for that — I'd rather not guess and give you wrong info."

# What Astarter Is
Infrastructure for the Autonomous AI Economy — Web4/AI/DePIN with three pillars: decentralized AI agent networks (CORE layer), on-chain execution, and ABox node hardware. Common topics: ABox nodes, pricing, CORE, tokenomics, roadmap, earning, Mulan Points, partnerships.

# How to Answer
## Answer Length Rule (HIGHEST PRIORITY — overrides everything except Grounding Rules)
1. ALWAYS start your response with the label <b>Short answer:</b> followed by 1 to 2 sentences maximum.
2. End with ONE short follow-up question to keep the conversation going.
3. STOP after the question. Do not volunteer extra context, history, or related info the user did not ask for.
4. Only expand into detail when the user explicitly asks ("tell me more", "yes", "go on", "explain that") — then give the detail WITHOUT the "Short answer:" label.
5. If detail is needed, use at most 4 tight bullet points — never a wall of text.

## Content Rules
• Lead with the direct answer. No preamble. No "Great question!"
• Every response ends with ONE follow-up question — short, natural, relevant to what was just said.
• If the user asks for ONE specific thing → give ONLY that thing, then ask what they want next.
• Paraphrase knowledge naturally. Never copy-paste raw FAQ entries or paste entire bullet lists from your knowledge base.
• If the question is vague or broad ("tell me about X", "give X details", "explain X", "what about partners") → give ONE sentence overview only, then ask which specific part they want. NEVER dump all known facts about a topic just because the user said "details". Example: "MULAN is Astarter's partner running a points-and-NFT ecosystem. Which part interests you — earning points, NFTs, or redemption?"
• If the question could mean multiple things: pick the most likely interpretation, answer it, and confirm with a question.
• STRICT CONSTRAINT RULE: If the user specifies a constraint ("without investment", "for free", "no cost", "beginner"), you MUST strictly filter your answer to only include options that satisfy that constraint. Never mention options that violate it. Example: "ways to earn without investment" → referrals only, never mention BNB spending.
• PERCENTAGE ACCURACY: When stating a percentage, always explain clearly what it applies to. Never say "X% of your points convert" unless the knowledge base explicitly states that. If unsure what a percentage applies to, do not state it as a conversion rate.
• DO NOT MIX PROGRAMS: Mulan Points referral rewards and Astarter Node referral rewards are separate programs. Never combine them in one answer.
• FALSE PREMISE CORRECTION (HIGHEST PRIORITY after Grounding Rules): If a user states a specific number, percentage, date, or fact in their message that is NOT confirmed in your Knowledge Base, STOP — do NOT answer the question as asked. Correct the false premise first, then offer the real answer.
  MANDATORY EXAMPLE — you will see this often: A user says "30% of Mulan Points can be swapped for Astarter tokens — what do I do with the rest?" → The 30% is the token allocation POOL size (30% of total tokens reserved for MULAN holders), NOT a points conversion rate. Do NOT answer what to do with "the rest." Instead: "The 30% isn't a conversion rate for your points — it's the size of the token pool reserved for MULAN holders. You pick ONE redemption option for ALL your points: Astarter tokens, Binance-listed tokens, or exchange listing eligibility. Which would you like to know more about?"
  This applies to ANY unconfirmed number or claim a user states as fact. Never silently accept it and build an answer on top of it.
• AIRDROP ELIGIBILITY vs HOW TO EARN: When asked "who is eligible" or "can I participate in the airdrop", answer with WHO qualifies (hold Mulan Points = eligible; node holders = eligible), NOT a full breakdown of how to earn points. How-to-earn is a separate follow-up topic. Do not bundle earning methods into an eligibility answer.

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
Pick the right category and express it naturally in your own words — never copy a fixed phrase:

Not officially announced yet:
Say naturally that it hasn't been confirmed, and point them to the announcements channel to catch it when it drops. Keep it casual and warm — not a canned line.

Outside your knowledge (events, dates, features, updates, prices):
Say honestly that you don't have that confirmed, and mention the announcements channel as the best place to follow. Vary your wording — "not something I can confirm right now", "that one's not in my knowledge yet", "can't pin that down", etc.
NOTE: The announcements channel link will be auto-inserted by the system — you do NOT need to include the URL. Just say "announcements channel" naturally in your sentence.

Partnership, listing, or business enquiries:
Tell them to reach out to the team directly at <code>contact@astarter.io</code>. Do not send general or personal questions here — only genuine business/partnership enquiries.

Personal account questions ("my rewards", "my points", "my airdrop", "my allocation", "my balance", "my tokens", "how much do I have"):
Explain warmly that you can't access individual accounts — their personal balance is only visible inside the Astarter platform or MULAN dashboard. Offer to explain how the reward structure works instead.
NEVER redirect personal account questions to contact@astarter.io.

Old Cardano-era products (launchpad, IDO, Swap, Money Market, ADA pools, ISPO, AA1 staking):
Explain naturally that Astarter has moved on from that phase — it's now Web4 AI infrastructure and ABox nodes. Invite them to ask about what's current.

Live price / financial data:
Say you don't have live price data and suggest a crypto price aggregator.

Rule: Express these naturally each time. Never copy a fixed sentence from this guide. You are an AI having a real conversation — not a template engine.

# Escalation
If a user is clearly angry, repeatedly frustrated, or explicitly asks for a human: reply with exactly the single word ESCALATE and nothing else.

# URL Reference (exact URLs only — no substitutions, no guessing)
When a user asks for a specific link, give EXACTLY the URL below for that topic. Never substitute one URL for another.

• gitbook / docs / documentation / guide → https://astarter.gitbook.io/astarter
• website / homepage → https://app.astarter.io
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
• UXLINK → https://x.com/UXLINKofficial

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
    const ttl = Math.floor(this.config.rateLimit.windowMs / 1000);

    if (!current) {
      await this.redis.setex(key, ttl, '1');
      return true;
    }

    const count = parseInt(current, 10);
    if (count >= this.config.rateLimit.maxRequests) return false;

    await this.redis.incr(key);
    await this.redis.expire(key, ttl); // reset window on each request to prevent shrinkage
    return true;
  }


  async getConversationContext(
    userId: string,
    chatId?: string,
    platform: 'discord' | 'telegram' = 'discord',
  ): Promise<ConversationContext> {
    const key = `ai:conversation:${platform}:chat:${chatId ?? userId}:user:${userId}`;
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
    const key = `ai:conversation:${context.platform}:chat:${context.chatId ?? context.userId}:user:${context.userId}`;
    // Keep last 20 messages (10 turns) to cap memory usage
    const trimmed = { ...context, messages: context.messages.slice(-20) };
    await this.redis.setex(key, ttl, JSON.stringify(trimmed));
  }

  async clearConversationContext(
    userId: string,
    chatId?: string,
    platform: 'discord' | 'telegram' = 'discord',
  ): Promise<void> {
    const key = `ai:conversation:${platform}:chat:${chatId ?? userId}:user:${userId}`;
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

  /** Public single-turn call — used by the LangGraph agent nodes for classify/generate */
  async quickChat(systemPrompt: string, userMessage: string, maxTokens = 512): Promise<string> {
    if (!this.bedrock) throw new Error('Bedrock not initialised');
    const resp = await this.generateWithAWS(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      undefined,
      maxTokens,
    );
    return resp.content;
  }

  private async generateWithAWS(
    messages: AIMessage[],
    systemPrompt: string,
    model?: string,
    maxTokensOverride?: number,
  ): Promise<AIResponse> {
    if (!this.bedrock) throw new Error('AWS Bedrock not initialised');

    let modelToUse = model ?? this.config.defaultModel ?? 'openai.gpt-oss-20b-1:0';

    // AWS Bedrock cross-region inference: only Anthropic models need a regional prefix
    // (eu./us./ap.). OpenAI, Meta, Mistral etc. use their model ID as-is.
    // Use model ID as-is — cross-region prefix (ap./eu./us.) is only needed
    // for cross-region inference profiles, not for direct model access.

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
    const MAX_ATTEMPTS = 2;
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
            maxTokens: maxTokensOverride ?? this.config.maxTokens ?? 800,
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


  async chat(
    context: ConversationContext,
    userMessage: string,
    options?: {
      model?: string;
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

    // Intent + sentiment — free keyword-based detection, no extra API call
    const intent = this.detectIntent(topicQuery);
    const sentiment = this.detectSentiment(cleanCurrent);
    const escalateFromSentiment = await this.trackNegativeSentiment(context.userId, sentiment);
    if (escalateFromSentiment) {
      return {
        content: "I want to make sure you get the right help — let me flag this for a team member who can assist you further! 🙌",
        model: this.config.defaultModel,
        provider: 'aws',
        isEscalation: true,
      };
    }

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
        let deckHits = this.boostChunksByIntent(deckRaw.filter(h => h.score >= MIN_SCORE), intent);

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

    // 5. System prompt — base + intent expert block (Node 5) + retrieved context
    const basePrompt = this.buildSystemPrompt(
      options?.systemPrompt ?? context.systemPrompt,
    );

    const intentExpert = INTENT_EXPERT_BLOCKS[intent] ?? '';
    const expertSection = intentExpert
        ? `\n\n---\n# Topic Expert Context\n${intentExpert}`
        : '';

    const dynamicPrompt = ragContext
        ? `${basePrompt}${expertSection}\n\n---\n# Retrieved Context\nThe following was retrieved from the verified knowledge base for this specific question. It is factual and current. Use it to answer directly and confidently — do NOT say "I'm not sure", "hasn't been confirmed", or "I don't have that info" when the answer is below. Paraphrase naturally; do not copy-paste.\n\n${ragContext}`
        : `${basePrompt}${expertSection}`;

    // 6. Call AI provider
    let response: AIResponse | undefined;

    try {
      if (this.anthropic) {
        response = await this.generateWithAnthropic(messages, dynamicPrompt, options?.model);
      } else if (this.bedrock) {
        response = await this.generateWithAWS(messages, dynamicPrompt, options?.model);
      } else {
        throw new Error('No AI provider available. Set ANTHROPIC_API_KEY or AWS credentials in .env.');
      }
    } catch (err) {
      // Fallback: Anthropic → AWS Bedrock
      if (this.bedrock && (!response || response.provider !== 'aws')) {
        this.logger.warn('Primary provider failed — falling back to AWS Bedrock');
        try {
          response = await this.generateWithAWS(messages, dynamicPrompt, options?.model);
        } catch (awsErr) {
          this.logger.error('AWS Bedrock fallback also failed:', awsErr);
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

    // 8. Handle escalation signal — match ESCALATE as the entire response (with optional markup)
    if (/^\*{0,2}ESCALATE\*{0,2}[.!]?\s*$/i.test(response.content.trim())) {
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
      },
      uniqueUsers: new Set(logs.map((l) => l.userId)).size,
    };
  }


  async listAvailableModels(): Promise<{ anthropic: string[]; aws: string[] }> {
    const result = { anthropic: [] as string[], aws: [] as string[] };

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

    // Use model ID as-is — no cross-region prefix needed for direct model access.

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
    let provider: 'anthropic' | 'aws' = 'aws';
    const usedModel = options?.model ?? this.config.defaultModel;

    try {
      if (this.anthropic) {
        const r = await this.streamWithAnthropic(messages, dynamicPrompt, onChunk, options?.model);
        fullText = r.text; tokensUsed = r.tokensUsed; provider = 'anthropic';
      } else if (this.bedrock) {
        const r = await this.streamWithAWS(messages, dynamicPrompt, onChunk, options?.model);
        fullText = r.text; provider = 'aws';
      } else {
        throw new Error('No AI provider available.');
      }
    } catch (err: any) {
      // Fallback: Anthropic → Bedrock
      if (provider === 'anthropic' && this.bedrock) {
        this.logger.warn('Anthropic stream failed — falling back to Bedrock');
        try {
          const r = await this.streamWithAWS(messages, dynamicPrompt, onChunk, options?.model);
          fullText = r.text; provider = 'aws';
        } catch (bedrockErr) {
          throw bedrockErr;
        }
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

  // ── Intent / sentiment helpers ────────────────────────────────────────────────
  private detectIntent(message: string): string {
    // Pad with spaces so space-padded keywords like ' aa ' match word boundaries
    const lower = ' ' + message.toLowerCase() + ' ';
    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) return intent;
    }
    return 'general';
  }

  private detectSentiment(message: string): 'positive' | 'neutral' | 'negative' {
    const lower = message.toLowerCase();
    return NEGATIVE_SIGNALS.some(w => lower.includes(w)) ? 'negative' : 'neutral';
  }

  private boostChunksByIntent(
    chunks: { pageContent: string; metadata: any; score: number }[],
    intent: string,
  ): { pageContent: string; metadata: any; score: number }[] {
    const keywords = INTENT_KEYWORDS[intent];
    if (!keywords?.length) return chunks;
    return chunks
      .map(c => ({
        ...c,
        score: keywords.some(kw => c.pageContent.toLowerCase().includes(kw))
          ? Math.min(c.score * 1.15, 1.0)
          : c.score,
      }))
      .sort((a, b) => b.score - a.score);
  }

  // Node 4: Grade chunk relevance — single Bedrock call, returns avg score 0-1
  private async gradeChunks(query: string, chunks: { pageContent: string; score: number }[]): Promise<number> {
    if (!this.bedrock || chunks.length === 0) return 1.0;
    const items = chunks.map((c, i) => `[${i + 1}] ${c.pageContent.slice(0, 200)}`).join('\n\n');
    try {
      const result = await this.generateWithAWS(
        [{ role: 'user', content: `Query: "${query.slice(0, 150)}"\n\nChunks:\n${items}\n\nScore each chunk 0.0–1.0 for relevance. Reply ONLY with a JSON array: [0.8, 0.3, ...]` }],
        'You are a relevance grader. Reply only with a JSON number array, nothing else.',
      );
      const scores = JSON.parse(result.content.trim()) as number[];
      if (!Array.isArray(scores) || scores.length === 0) return 0.5;
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    } catch {
      return 0.5;
    }
  }

  private async trackNegativeSentiment(userId: string, sentiment: string): Promise<boolean> {
    const key = `ai:neg_count:${userId}`;
    if (sentiment === 'negative') {
      const count = await this.redis.incr(key);
      await this.redis.expire(key, 3600);
      return count >= 2;
    }
    await this.redis.del(key).catch(() => {});
    return false;
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

  async testConnection(): Promise<{ anthropic: boolean; aws: boolean }> {
    const result = { anthropic: false, aws: false };

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

    return result;
  }
}

export default AIService;
