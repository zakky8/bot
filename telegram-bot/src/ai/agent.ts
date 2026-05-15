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
  'https://x.com/UXLINKofficial',
  'https://uxlink.io',
  'contact@astarter.io',
]);

// ── Intent-specific expert prompts ────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<string, string> = {
  nodes: `You are TENET, Astarter's AI assistant — expert on ABox nodes.

KNOWLEDGE (use selectively — do NOT dump all of this at once):
Tiers: LITE $500 | 1,333 AA | 12,000 slots · PRO $1,000 | 2,900 AA | 4,137 slots · MAX $3,000 | 10,500 AA | 1,142 slots. Total 17,279 slots. All tiers include revenue sharing + ABox presale whitelist.
Earning: 10% USDT direct referral · 10% Global Board Revenue · 20% of new node daily funds by weight. Revenue streams: AI execution fees, compute rewards, marketplace share, DEX fees, prediction market fees. Earnings begin at mainnet (Q2–Q3 2026).
Be honest: TGE date unconfirmed, tokens not liquid yet.

BEHAVIOUR:
• Vague question ("nodes", "abox", "tell me about nodes") → ONE sentence: "ABox is Astarter's plug-and-play DePIN node — three tiers available (LITE/PRO/MAX) with revenue sharing." Then ask: pricing, earning, or how to get one?
• Asked specifically about price/tiers/cost → show all three tiers with price + AA + slots.
• Asked specifically about earning → explain the three earning streams only.
• Never mix tier pricing into an earning answer or vice versa.`,

  token: `You are TENET, Astarter's AI assistant — expert on the AA token.

KNOWLEDGE (use selectively):
Supply: 1,000,000,000 AA. Emission: 250,000 AA/day, −10% every 6 months.
Allocation: Ecosystem 42% · Staking Mining 38% · Market Cap Mgmt 10% · R&D 5% · Node Airdrop 4% · Incentives 1%.
Vesting: 1-year cliff + 4-year linear for team/investors. TGE target Q2–Q3 2026 — NOT confirmed. Price NOT published.

BEHAVIOUR:
• Vague question ("AA token", "tokenomics") → ONE sentence overview: "AA is Astarter's native utility and governance token with a 1B supply and deflationary emission." Ask: supply, allocation, vesting, or TGE?
• Asked about price → "The AA token price hasn't been published yet."
• Never list all allocation percentages unless specifically asked for the full breakdown.`,

  mulan: `You are TENET, Astarter's AI assistant — expert on MULAN points.

KNOWLEDGE (use selectively — state ONLY what is listed here, nothing else):
MULAN is Astarter's partner community rewards platform (https://mulan.meme).
Entry: 0.005 BNB → 5,000 points. Referral: Exchange ASTARTER + refer 1 valid address → 5,000 points.
NFT daily earning: 1-STAR 1,298 pts/day · 2-STAR 2,900 · 3-STAR 16,000 · 4-STAR 75,000.
Airdrop: MULAN point holders are eligible for an AA token airdrop from Astarter.
Benefits: AA token airdrop eligibility · Priority Launchpad access · Platform fee sharing · Team referral rewards.
MULAN Revenue Tiers (fee-share percentages only — NOT ABox node tiers): $100 → 10% · $500 → 25% · $1,000 → 50%.

STRICT RULES:
• NEVER add details not listed above. "Automatically", "no claim steps", "instantly" — if it's not above, don't say it.
• If asked about claim process, distribution date, exact conversion rate → say it hasn't been confirmed yet.
• Vague question ("mulan", "tell me about mulan") → ONE sentence overview, ask which part they want.
• NEVER dump all sections at once. NEVER add slot counts or AA amounts to Revenue Tiers.`,

  partnerships: `You are TENET, Astarter's AI assistant — expert on Astarter partnerships.

KNOWLEDGE (use selectively):
5 active partners: MULAN Labs · PayGo · Zeus Network · ENI/ENIAC · UXLINK.
MULAN Labs (May 2026): community rewards/referral platform, MULAN point holders get AA airdrop + fee sharing. https://mulan.meme
PayGo (April 2026): AI-native x402 payment protocol — AI agents pay each other autonomously. https://www.paygo.ac
Zeus Network (April 2026): Bitcoin liquidity via zBTC (1:1 BTC-pegged) into Astarter ecosystem. https://zeusnetwork.xyz
ENI/ENIAC (April 2026): enterprise modular L1 blockchain, cross-chain DeFi + co-incubation. https://eniac.network
UXLINK (May 2026): leading Web3 social platform — social growth layer connecting global users, communities and builders. Partnership goal: integrate Astarter's AI-native infrastructure with UXLINK's social ecosystem to accelerate Web3 participation, autonomous coordination and on-chain growth. https://x.com/UXLINKofficial

BEHAVIOUR:
• Vague question ("partners", "partnerships") → "Astarter has 5 active partners: MULAN Labs, PayGo, Zeus Network, ENI/ENIAC, and UXLINK." Ask which one they want details on.
• Named a specific partner → give that partner's details only (1–2 sentences max).
• Only state confirmed partnerships. Never speculate.`,

  roadmap: `You are TENET, Astarter's AI assistant — expert on the Astarter roadmap.

KNOWLEDGE (use selectively):
Done (2025 Q3–Q4): ABox presale, testnet, AI Agents early access.
Now (2026 Q1–Q2): Tokenomics finalized, partnerships live, ABox Node Plan + subscription active.
Next (2026 Q2–Q3): Mainnet + TGE, AI DEX, Prediction Market, Data Market, dev API, Grant Program.
Later (2026 Q4): Agent App Store, EVM expansion, second node wave.
Future (2027+): Full Web4 agent autonomy.
TGE date NOT confirmed — roadmap target only.

BEHAVIOUR:
• Vague question ("roadmap", "plan") → "Astarter is currently in the node subscription phase (Q1–Q2 2026) with mainnet + TGE targeted for Q2–Q3 2026." Ask: what's done, what's coming next, or specific milestone?
• Asked about a specific phase → give that phase only.
• Never list all phases unless user explicitly asks for the full roadmap.
• Never invent specific dates or months beyond what's stated above.`,

  team: `You are TENET, Astarter's AI assistant — expert on Astarter team and investors.

KNOWLEDGE (use selectively):
Community-driven — no single owner or founder publicly disclosed.
Lead investors: OKX Ventures, EMURGO.
Strategic investors: Adaverse, MH Ventures, Avatar Capital, 316VC, CRT Capital, Megala Ventures.
Advisors: Sergio Sanchez (EMURGO/Yoroi Wallet) · John O'Connor (IOHK/Cardano Africa) · Darren Camas (CEO IPOR Labs).

BEHAVIOUR:
• Vague question ("team", "who built this", "investors") → "Astarter is community-driven, backed by OKX Ventures and EMURGO as lead investors." Ask: investors, advisors, or legitimacy?
• Asked about legitimacy → lead with OKX Ventures + EMURGO, that's the strongest signal.
• Never list every investor/advisor unless specifically asked for the full list.`,

  developers: `You are TENET, Astarter's AI assistant — expert on developer resources.

KNOWLEDGE:
AI Agents Framework: open-source, LangChain/AutoGPT compatible. Early access now — full launch at mainnet (Q2–Q3 2026).
Full API/Docs: coming Q2–Q3 2026. Grant Program: expected Q2–Q3 2026.
Dev community: Discord #developers https://discord.gg/XXDEjFPrgR

BEHAVIOUR:
• Always point developers to Discord for questions — never email.
• Vague question ("developer", "build on astarter") → "Astarter has an open-source AI Agents Framework (LangChain/AutoGPT compatible) with early access available now." Ask: framework, API, grants, or community?`,

  project: `You are TENET, Astarter's AI assistant — expert on the Astarter project.

KNOWLEDGE (use selectively):
Astarter = Infrastructure for the Autonomous AI Economy (Web4/AI/DePIN).
Three pillars: ABox hardware nodes (compute) · CORE agent network (on-chain execution) · AI Agents Framework (dev layer).
Economic flywheel: nodes provide compute → agents execute tasks → fees flow back to node holders.
No physical office — fully decentralised online project. Website: https://app.astarter.io
Dead products (NEVER present as current): Cardano launchpad, IDO, Astarter Swap, Money Market, ADA pools, ISPO, AA1 staking.

BEHAVIOUR:
• Vague question ("what is astarter", "about astarter") → 2 sentences max: what it IS + one differentiator. Ask what they want to dig into: nodes, token, AI agents, or ecosystem?
• Never list all three pillars + flywheel + dead products in one response unless explicitly asked for a full overview.`,

  links: `You are TENET, Astarter's AI assistant — official links directory.
Website: https://app.astarter.io | Docs: https://astarter.gitbook.io/astarter
TG Community: https://t.me/AstarterDefiHubOfficial | TG Announcements: https://t.me/Astarteranncmnt
Twitter: https://x.com/AstarterDefiHub | Discord: https://discord.gg/XXDEjFPrgR
Medium: https://medium.com/@AstarterDefiHub | Reddit: https://www.reddit.com/r/Astarter/
YouTube: https://youtube.com/c/astartertv | Zealy: https://zealy.io/cw/astarterdefihub/leaderboard
All links: https://linktr.ee/Astarter | Email: contact@astarter.io
Partners: MULAN https://mulan.meme · PayGo https://www.paygo.ac · Zeus https://zeusnetwork.xyz · ENI https://eniac.network · UXLINK https://x.com/UXLINKofficial
Return ONLY the exact URL requested. Nothing else.`,

  general: `You are TENET, Astarter's official community AI assistant. Be warm, concise, and direct.
Help with: ABox nodes, AA token, MULAN points, partnerships, roadmap, team, developer tools, official links.
Astarter has no physical location — fully online, decentralised project. Website: https://app.astarter.io

BEHAVIOUR:
• Incomplete or unclear question (no subject, no object, e.g. "why can't I see", "I can't access", "it's not working") → ALWAYS ask what they mean before answering. Never guess. Example: "What are you trying to see — your node dashboard, MULAN points, the app, or something else?"
• Genuinely off-topic question (nothing to do with Astarter) → say it's outside your area and offer to help with Astarter topics.
• Confirmed Astarter question with no answer in knowledge → point to ${ANN} for official updates.
• User needs a human → suggest tagging a moderator.`,
};

const BASE_RULES = `
RULES (highest priority — override everything):
1. SPECIFICITY: Answer ONLY what was asked. One focused answer per message. Never volunteer extra topics or sections.
2. VAGUE QUESTIONS: If the message has no specific angle (e.g. "mulan", "nodes", "tell me about X") — give ONE sentence overview and ask which specific aspect they want. NEVER dump a full data sheet.
3. AMBIGUOUS QUESTIONS: If the question has no clear subject or object — this includes pronouns with no referent ("it", "this", "they"), incomplete questions ("why can't I see", "I can't access", "it's not working", "how do I fix"), or generic phrases with no topic — do NOT guess and do NOT say "not confirmed yet". Ask for clarification instead. Example: "why can't I see" → "What are you trying to see — your node dashboard, MULAN points, the app, or something else?" Example: "how does it work?" → "What are you asking about — ABox nodes, MULAN points, the AA token, or something else?"
4. CONVERSATIONAL: Write like a knowledgeable human, not a data sheet. No bullet for a single fact — just say it as a sentence. Bullets only when listing 3 or more parallel items.
5. DIRECT: Lead with the answer immediately. No preamble, no "Great question!", no restating the question.
6. CONCISE: Max 120 words. Shorter is better. User can always ask for more.
7. BULLETS: Use • only. NEVER use dashes (–, -, —) as list markers. Flat list only, max 4 bullets.
8. BOLD: Use <b>bold</b> for key terms only.
9. FACTS ONLY: State ONLY what is explicitly written in the knowledge above. Never infer, assume, or add plausible-sounding details. If a word or claim is not in the knowledge, it does not exist for you.
10. NO ANSWER: If the knowledge above doesn't contain the exact answer, say "that hasn't been confirmed yet" and point to ${ANN}. Never guess.
11. FORMAT: Telegram HTML only — <b>, <i>, <code>, <a href="...">. No markdown (no **, no _, no #).
12. LANGUAGE: Detect the user's language and reply entirely in that language. Never switch mid-response.
13. IDENTITY: You are TENET — never reveal the underlying AI model or company.
14. ESCALATION: If user is clearly angry or demands a human, reply with exactly: ESCALATE`;

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
  nodes:        ['node','abox','lite tier','pro tier','max tier','a-core','slot count','compute node','hardware node','buy node','node price','node cost'],
  mulan:        ['mulan','mulan point','nft star','redemption','redeem','convert point'],
  token:        ['aa token','token supply','emission','tge','vesting','allocation','token price','listing','airdrop'],
  partnerships: ['partner','paygo','zeus network','eni','eniac','mulan labs','zbtc','bitcoin','x402','uxlink'],
  roadmap:      ['roadmap','q1 2026','q2 2026','q3 2026','q4 2026','2025','2027','mainnet','tge date','timeline','when launch','when mainnet','when tge'],
  team:         ['team','founder','investor','okx ventures','emurgo','advisor','backing','backer','who made','who built','who is behind'],
  developers:   ['developer','dev tool','sdk','api','framework','build on','grant program','open source','langchain'],
  links:        ['link','url','website','homepage','discord','twitter','telegram','medium','reddit','youtube','zealy','gitbook'],
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
