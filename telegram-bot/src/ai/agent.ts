/**
 * TENET — LangGraph.js AI Agent (TypeScript, single process)
 *
 * 5-node state machine:
 *   START → classify → checkSentiment → retrieve → generate → outputCheck → END
 *                                ↓ (escalate)
 *                               END
 */

import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph';
import { aiService } from '../core/ai';

const ANN = 'https://t.me/Astarteranncmnt';

// ── Allowed URLs (output guard) ───────────────────────────────────────────────
const ALLOWED_URLS = new Set([
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
  'https://mulan.meme',
  'https://www.paygo.ac',
  'https://x.com/PayGo402',
  'https://t.me/Paygo_eni',
  'https://zeusnetwork.xyz',
  'https://x.com/ZeusNetworkHQ',
  'https://discord.gg/zeusnetwork',
  'https://eniac.network',
  'https://docs.eniac.network',
  'https://x.com/ENI__Official',
  'https://t.me/ENI_Channel',
  'https://t.me/ENI_Community',
  'contact@astarter.io',
]);

// ── Intent-specific expert prompts ────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<string, string> = {
  nodes: `You are TENET, Astarter's AI assistant — expert on ABox nodes.
Node tiers: LITE ($500 | 1,333 AA | 12,000 slots) · PRO ($1,000 | 2,900 AA | 4,137 slots) · MAX ($3,000 | 10,500 AA | 1,142 slots). Total: 17,279 slots.
Earning: 10% USDT direct referral · 10% Global Board Revenue · 20% of new node daily funds by weight.
Revenue streams: AI execution fees, compute rewards, marketplace share, DEX fees, prediction market fees. Earning begins at mainnet (Q2–Q3 2026).
Be direct and honest. Warn that TGE date is unconfirmed and tokens aren't liquid yet.`,

  token: `You are TENET, Astarter's AI assistant — expert on AA token.
Total supply: 1,000,000,000. Emission: 250,000 AA/day, −10% every 6 months.
Allocation: Ecosystem 42% · Staking Mining 38% · Market Cap Mgmt 10% · R&D 5% · Node Airdrop 4% · Incentives 1%.
Vesting: 1-year cliff + 4-year linear for team/investors. TGE target: Q2–Q3 2026 — NOT officially confirmed. Price NOT published.
Never speculate on price. If pushed, say "not published yet".`,

  mulan: `You are TENET, Astarter's AI assistant — expert on MULAN points.
Entry: 0.005 BNB → 5,000 points. Referral: Exchange ASTARTER + refer 1 address → 5,000 points.
NFT daily earning: 1-STAR 1,298 pts · 2-STAR 2,900 · 3-STAR 16,000 · 4-STAR 75,000.
Redemption: MULAN points are redeemable for AA token (Astarter token airdrop). All MULAN point holders receive an Astarter AA token airdrop.
Node Revenue Tiers: $100→10% · $500→25% · $1,000→50% trading fee share.`,

  partnerships: `You are TENET, Astarter's AI assistant — expert on partnerships.
MULAN Labs (May 2026): Referral platform, MULAN holders get AA + NFT rewards. https://mulan.meme
PayGo (April 2026): AI-native x402 payment — agents pay each other autonomously. https://www.paygo.ac
Zeus Network (April 2026): Bitcoin liquidity via zBTC (1:1 BTC). https://zeusnetwork.xyz
ENI/ENIAC (April 2026): Enterprise modular L1, co-incubation. https://eniac.network
Only state official partnerships. Do not speculate on future ones.`,

  roadmap: `You are TENET, Astarter's AI assistant — expert on the Astarter roadmap.
2025 Q3–Q4 (DONE): ABox presale, testnet, AI Agents early access.
2026 Q1–Q2 (NOW): Tokenomics finalized, partnerships live, ABox Node Plan + subscription.
2026 Q2–Q3 (NEXT): Mainnet + TGE, AI DEX/Prediction/Data markets, dev API, Grant Program.
2026 Q4: Agent App Store, EVM expansion, second node wave. 2027+: Full Web4 autonomy.
TGE date is NOT confirmed — target only. Do not invent specific dates.`,

  team: `You are TENET, Astarter's AI assistant — expert on Astarter team and investors.
Community-driven — no single owner publicly named.
Lead investors: OKX Ventures, EMURGO. Strategic: Adaverse, MH Ventures, Avatar Capital, 316VC, CRT Capital, Megala Ventures.
Advisors: Sergio Sanchez (EMURGO/Yoroi) · John O'Connor (IOHK/Cardano) · Darren Camas (IPOR Labs).
For legitimacy questions: OKX Ventures + EMURGO backing is the strongest signal.`,

  developers: `You are TENET, Astarter's AI assistant — expert on developer resources.
AI Agents Framework: open-source, LangChain/AutoGPT compatible. LIVE at mainnet.
Full API/Docs: coming Q2–Q3 2026. Grant Program: expected Q2–Q3 2026.
Dev community: Discord #developers https://discord.gg/XXDEjFPrgR
Dev enquiries: contact@astarter.io`,

  project: `You are TENET, Astarter's AI assistant — expert on the Astarter project.
Astarter = Infrastructure for the Autonomous AI Economy (Web4/AI/DePIN).
Three pillars: ABox hardware nodes (compute layer) · CORE agent network (execution layer) · AI Agents Framework (dev layer).
Economic flywheel: nodes provide compute → agents execute tasks → fees flow back to node holders.
Location/HQ: Astarter is a fully decentralised online project — there is no physical office or headquarters. Everything runs online. Website: https://www.astarter.io
Dead products (never present as current): Cardano launchpad, IDO, Astarter Swap, Money Market, ADA pools, ISPO, AA1 staking.`,

  links: `You are TENET, Astarter's AI assistant — official links directory.
Website: https://www.astarter.io | Docs: https://astarter.gitbook.io/astarter
TG Community: https://t.me/AstarterDefiHubOfficial | TG Announcements: https://t.me/Astarteranncmnt
Twitter: https://x.com/AstarterDefiHub | Discord: https://discord.gg/XXDEjFPrgR
Medium: https://medium.com/@AstarterDefiHub | Reddit: https://www.reddit.com/r/Astarter/
YouTube: https://youtube.com/c/astartertv | Zealy: https://zealy.io/cw/astarterdefihub/leaderboard
All links: https://linktr.ee/Astarter | Email: contact@astarter.io
Partners: MULAN https://mulan.meme · PayGo https://www.paygo.ac · Zeus https://zeusnetwork.xyz · ENI https://eniac.network
Return ONLY the exact URL requested. Nothing else.`,

  general: `You are TENET, Astarter's official community AI assistant. Be warm, concise, and direct.
Help with: ABox nodes, AA token, MULAN points, partnerships, roadmap, team, developer tools, official links.
Astarter has no physical location or office — it is a fully online, decentralised project. Website: https://www.astarter.io
For unknown topics: point to ${ANN} for official updates.
For human help: suggest tagging a moderator.`,
};

const BASE_RULES = `
RULES (highest priority):
- Lead with the direct answer immediately. No preamble, no "Short answer:" label.
- Give a complete, helpful answer — use as many sentences as needed to fully explain. Do NOT truncate.
- Use <b>bold</b> for key terms, <i>italic</i> for emphasis. Use bullet lists for 3+ items.
- Only state facts from the knowledge context provided. Never invent prices, dates, APY, or wallet addresses.
- If context doesn't contain the answer, say so and point to ${ANN}.
- Format: Telegram HTML only (<b>, <i>, <code>, <a href="...">). No markdown.
- CRITICAL LANGUAGE RULE: Detect the language of the user's message and reply ENTIRELY in that same language. Every single sentence including follow-up questions must be in the user's language. Never switch languages mid-response.
- Identity: You are TENET — never name any underlying AI model or company.
- Escalation: if user is clearly angry or asks for a human, reply with exactly: ESCALATE`;

// ── State schema ──────────────────────────────────────────────────────────────
const AgentState = Annotation.Root({
  message:       Annotation<string>({ reducer: (_, u) => u, default: () => '' }),
  language:      Annotation<string | null>({ reducer: (_, u) => u, default: () => null }),
  intent:        Annotation<string>({ reducer: (_, u) => u, default: () => 'general' }),
  sentiment:     Annotation<string>({ reducer: (_, u) => u, default: () => 'neutral' }),
  negativeCount: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
  chunks:        Annotation<Array<{ pageContent: string; metadata: any; score: number }>>({ reducer: (_, u) => u, default: () => [] }),
  history:       Annotation<Array<{ role: 'user' | 'assistant'; content: string }>>({
    reducer: (existing, update) => [...existing, ...update].slice(-20),
    default: () => [],
  }),
  response:      Annotation<string>({ reducer: (_, u) => u, default: () => '' }),
  escalate:      Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
  escalateReason:Annotation<string>({ reducer: (_, u) => u, default: () => '' }),
});

type S = typeof AgentState.State;

// ── Node 1: Classify intent + sentiment — pure keyword matching, no LLM call ──
const INTENT_KEYWORDS: Record<string, string[]> = {
  nodes:        ['node','abox','lite','pro','max','a-core','slot','tier','earn','reward','compute','hardware'],
  mulan:        ['mulan','mulan point','nft star','redemption','redeem','convert point'],
  token:        ['aa token','token supply','emission','tge','vesting','allocation','token price','listing','airdrop'],
  partnerships: ['partner','paygo','zeus','eni','eniac','mulan labs','zbtc','bitcoin','x402'],
  roadmap:      ['roadmap','plan','q1','q2','q3','q4','2025','2026','2027','mainnet','launch','when','timeline'],
  team:         ['team','founder','investor','okx','emurgo','advisor','backing','backer','who made','who built'],
  developers:   ['developer','dev','sdk','api','framework','build','grant','open source','langchain'],
  links:        ['link','url','website','site','discord','twitter','telegram','medium','reddit','youtube','zealy','gitbook'],
  project:      ['what is astarter','astarter is','about astarter','location','office','hq','headquarter','web4','depin','core agent'],
};
const NEGATIVE_WORDS = ['scam','rug','fraud','fake','lie','lying','cheat','stolen','lost','angry','frustrated','useless','terrible','worst','broken','failed','refund','sue','legal'];

function classify(state: S): Partial<S> {
  const msg = state.message.toLowerCase();

  // Sentiment — keyword scan
  const isNegative = NEGATIVE_WORDS.some(w => msg.includes(w));
  const sentiment  = isNegative ? 'negative' : 'neutral';

  // Intent — first keyword match wins; fall back to general
  let intent = 'general';
  for (const [key, words] of Object.entries(INTENT_KEYWORDS)) {
    if (words.some(w => msg.includes(w))) { intent = key; break; }
  }

  return { intent, sentiment, escalate: false, escalateReason: '' };
}

// ── Node 2: Sentiment — track negatives, escalate at 2 ───────────────────────
function checkSentiment(state: S): Partial<S> {
  const neg = state.sentiment === 'negative' ? (state.negativeCount ?? 0) + 1 : 0;
  if (neg >= 2) {
    return {
      negativeCount: neg,
      escalate: true,
      escalateReason: '2 consecutive negative turns',
      response: "I want to make sure you get the right help — a moderator has been notified and will follow up shortly! 🙌",
    };
  }
  return { negativeCount: neg };
}

// ── Node 3: Retrieve relevant chunks ─────────────────────────────────────────
async function retrieve(state: S): Promise<Partial<S>> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('retrieve timeout')), 8000)
    );
    const raw = await Promise.race([
      aiService.searchDocs(state.message, 5, ['astarter_deck', 'manual']),
      timeout,
    ]);
    return { chunks: raw.filter(c => c.score >= 0.32) };
  } catch {
    return { chunks: [] }; // skip RAG — still answers from system prompt knowledge
  }
}

// ── Node 4: Generate response ─────────────────────────────────────────────────
async function generate(state: S): Promise<Partial<S>> {
  const intent = state.intent ?? 'general';
  const systemBase = SYSTEM_PROMPTS[intent] ?? SYSTEM_PROMPTS.general!;
  const system = `${systemBase}\n\n${BASE_RULES}`;

  // Build context from chunks
  const context = state.chunks.length > 0
    ? `\n\n# Retrieved Context (use this — it is verified and current)\n${state.chunks.map(c => c.pageContent).join('\n---\n')}`
    : '';

  // Build history block (last 3 turns)
  const hist = (state.history ?? []).slice(-6);
  const histBlock = hist.length > 0
    ? `\nRecent conversation:\n${hist.map(m => `${m.role === 'user' ? 'User' : 'TENET'}: ${m.content}`).join('\n')}\n`
    : '';

  // Language instruction
  const langNote = state.language ? `\nReply in ${state.language}.\n` : '';

  const userPrompt = `${langNote}${histBlock}${context}\n\nUser: ${state.message}`;

  let response: string;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('generate timeout')), 28000)
    );
    response = await Promise.race([aiService.quickChat(system, userPrompt, 1024), timeout]);
  } catch {
    response = `I'm having trouble right now. Please check the announcements channel for the latest updates.`;
  }

  return {
    response,
    history: [
      { role: 'user',      content: state.message },
      { role: 'assistant', content: response },
    ],
  };
}

// ── Node 5: Output check (no LLM — pure regex) ───────────────────────────────
function outputCheck(state: S): Partial<S> {
  let text = state.response ?? '';

  // Strip disallowed URLs
  text = text.replace(/https?:\/\/[^\s<>"')]+/g, url => {
    const clean = url.replace(/[.,;!?)]+$/, '');
    for (const a of ALLOWED_URLS) {
      if (clean === a || clean.startsWith(a + '/')) return url;
    }
    return '';
  });

  // Detect ESCALATE signal from model
  if (/^\*{0,2}ESCALATE\*{0,2}[.!]?\s*$/i.test(text.trim())) {
    return {
      escalate: true,
      escalateReason: 'AI escalation signal',
      response: "I want to make sure you get the right help — a moderator has been notified and will follow up shortly! 🙌",
    };
  }

  // Identity leak guard
  if (/I (am|'m) (gpt|claude|gemini|llama|openai|anthropic)/i.test(text)) {
    text = `I'm TENET, Astarter's support assistant! What can I help you with? 😊`;
  }

  // Dead-end fallback
  if (!text.trim() || text.trim().length < 10) {
    text = `I don't have confirmed details on that yet — check the announcements channel for the latest updates.`;
  }

  return { response: text };
}

// ── Graph assembly ────────────────────────────────────────────────────────────
const workflow = new StateGraph(AgentState)
  .addNode('classify',       classify)
  .addNode('checkSentiment', checkSentiment)
  .addNode('retrieve',       retrieve)
  .addNode('generate',       generate)
  .addNode('outputCheck',    outputCheck)
  .addEdge(START, 'classify')
  .addEdge('classify', 'checkSentiment')
  .addConditionalEdges('checkSentiment', (s: S) => s.escalate ? 'end' : 'retrieve', {
    end: END,
    retrieve: 'retrieve',
  })
  .addEdge('retrieve', 'generate')
  .addEdge('generate', 'outputCheck')
  .addEdge('outputCheck', END);

// MemorySaver: in-process checkpointing (conversation state persists across
// turns for the same thread_id during the bot's lifetime)
const checkpointer = new MemorySaver();
const graph = workflow.compile({ checkpointer });

// ── Public API ────────────────────────────────────────────────────────────────
export interface AgentResult {
  response: string;
  escalate: boolean;
  escalateReason: string;
  intent: string;
}

export async function runAgent(
  chatId: number,
  userId: string,
  message: string,
  language: string | null,
): Promise<AgentResult> {
  const threadId = `tg-${chatId}-${userId}`;
  const config   = { configurable: { thread_id: threadId } };

  const result = await graph.invoke({ message, language }, config);

  return {
    response:      result.response      || '',
    escalate:      result.escalate      || false,
    escalateReason:result.escalateReason|| '',
    intent:        result.intent        || 'general',
  };
}
