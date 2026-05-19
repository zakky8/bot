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
import { tryCannedReply, cannedIntent } from './fastPath';
import { verifyDraft } from './verifier';
import { rerankChunks } from './reranker';
import { speculativeRAG } from './speculative';

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
  'https://linktr.ee/uxlink_official',
  // Partner links — SumPlus
  'https://www.sumplus.xyz',
  // Partner links — ANT.FUN (Social DEX, May 2026)
  'https://x.com/ant_fun_trade',
  'https://ant.fun',
  'http://ant.fun',
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
• Asked about "profit cap / profit quota / earnings limit / participant cap": the SLOT COUNTS per tier (LITE 12,000 · PRO 4,137 · MAX 1,142, total 17,279) ARE the participant cap. Whether there's a per-node earnings ceiling on the revenue sharing isn't publicly confirmed — route detailed questions to the Astarter Discord ticket: https://discord.gg/XXDEjFPrgR
• If user mentions "10%–50% revenue sharing" with nodes — that's likely MULAN Revenue Tiers ($100→10%, $500→25%, $1,000→50%), NOT ABox nodes. Ask which they mean before answering, or briefly disambiguate both.
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
6 active partners: MULAN Labs · PayGo · Zeus Network · ENI/ENIAC · UXLINK · SumPlus.
MULAN Labs (May 2026): community rewards/referral platform, MULAN point holders get AA airdrop + fee sharing. https://mulan.meme
PayGo (April 2026): AI-native x402 payment protocol — AI agents pay each other autonomously. https://www.paygo.ac
Zeus Network (April 2026): Bitcoin liquidity via zBTC (1:1 BTC-pegged) into Astarter ecosystem. https://zeusnetwork.xyz
ENI/ENIAC (April 2026): enterprise modular L1 blockchain, cross-chain DeFi + co-incubation. https://eniac.network
UXLINK (May 2026): leading Web3 social platform — social growth layer connecting global users, communities and builders. Partnership goal: integrate Astarter's AI-native infrastructure with UXLINK's social ecosystem to accelerate Web3 participation, autonomous coordination and on-chain growth. https://x.com/UXLINKofficial | https://uxlink.io | https://linktr.ee/uxlink_official
SumPlus (May 2026): DeFi real-time data layer — gives Astarter AI Agents one-click access via MCP to TVL, protocol core indicators, heterogeneous chain ecology and cross-chain panoramic analysis. Delivers the "data vision" layer complementing Astarter's on-chain execution. https://www.sumplus.xyz

BEHAVIOUR:
• Vague question ("partners", "partnerships") → "Astarter has 6 active partners: MULAN Labs, PayGo, Zeus Network, ENI/ENIAC, UXLINK, and SumPlus." Ask which one they want details on.
• Named a specific partner → give that partner's details only (1–2 sentences max).
• Partnership proposal / collaboration inquiry / business pitch / AMA request / any "who do I contact" question → Acknowledge their specific inquiry in 1–3 words (e.g. "For partnership talks," / "For AMA requests," / "For promotion pitches,"), then direct to the Discord ticket — https://discord.gg/XXDEjFPrgR. 1–2 sentences. Vary phrasing naturally. Never say "not confirmed". Never suggest DMs or PMs.
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

KNOWLEDGE — only use the URL the user asked for:
• Website → https://app.astarter.io
• Docs / Gitbook → https://astarter.gitbook.io/astarter
• TG Community → https://t.me/AstarterDefiHubOfficial
• TG Announcements → https://t.me/Astarteranncmnt
• Twitter / X → https://x.com/AstarterDefiHub
• Discord → https://discord.gg/XXDEjFPrgR
• Medium → https://medium.com/@AstarterDefiHub
• Reddit → https://www.reddit.com/r/Astarter/
• YouTube → https://youtube.com/c/astartertv
• Zealy → https://zealy.io/cw/astarterdefihub/leaderboard
• Partners: MULAN https://mulan.meme · PayGo https://www.paygo.ac · Zeus https://zeusnetwork.xyz · ENI https://eniac.network · UXLINK https://uxlink.io · SumPlus https://www.sumplus.xyz

BEHAVIOUR (strict):
• If user asks for "all links" / "every link" / "list of links" / "official links" → reply with EXACTLY this one line and nothing else: <a href="https://linktr.ee/Astarter">linktr.ee/Astarter</a> — full directory of official Astarter & partner links.
• If user asks for ONE specific platform (e.g. "discord link", "website") → reply with EXACTLY one sentence in this shape: "Astarter's <b>&lt;Label&gt;</b>: &lt;URL&gt;" — no list, no other URLs.
• NEVER dump multiple URLs in a single reply. NEVER list out the full catalogue.
• NEVER add explanation, follow-up, or commentary unless the user asked.
• If the requested platform is not in the list above → "I don't have a confirmed URL for that — try the directory: https://linktr.ee/Astarter"`,

  general: `You are TENET, Astarter's official community AI assistant. Be warm, concise, and direct.
Help with: ABox nodes, AA token, MULAN points, partnerships, roadmap, team, developer tools, official links.
Astarter has no physical location — fully online, decentralised project. Website: https://app.astarter.io

BEHAVIOUR:
• Incomplete or unclear question (no subject, no object, e.g. "why can't I see", "I can't access", "it's not working") → ALWAYS ask what they mean before answering. Never guess. Example: "What are you trying to see — your node dashboard, MULAN points, the app, or something else?"
• Outreach / contact inquiry (AMA request, pin post, collaboration, tech issue, "who do I contact", "how do I reach the team") → Acknowledge their specific request type briefly (e.g. "For AMA inquiries," / "For pin post requests," / "For collaboration pitches,"), then direct to a ticket in the Astarter Discord — https://discord.gg/XXDEjFPrgR. 1–2 sentences. Vary phrasing. Never say "not confirmed". Never suggest DMs or PMs.
• "What's new" / "latest update" / "any news" / "recent changes" → the most recently confirmed item is the SumPlus partnership (May 2026 — DeFi data layer via MCP). State that one fact then point to ${ANN} for everything else. NEVER fabricate generic updates ("performance tweaks", "new MULAN features", "AA utility expansions" — all hallucinations).
• Genuinely off-topic question (nothing to do with Astarter) → say it's outside your area and offer to help with Astarter topics.
• Confirmed Astarter question with no answer in knowledge → point to ${ANN} for official updates.
• User needs a human → suggest tagging a moderator.`,
};

const BASE_RULES = `
═══════════════════════════════════════════════════════════════
ANTHROPIC-STYLE REASONING PROTOCOL (highest priority — read first)
═══════════════════════════════════════════════════════════════

THINKING FIRST (hidden from user):
Before writing your answer, reason inside ONE <thinking>...</thinking> block. The block is stripped before the user sees anything. Use it exactly like this:
<thinking>
1. What is the user actually asking? (intent, not literal keywords)
2. Which exact line in my KNOWLEDGE block or Retrieved Context answers this? Quote it verbatim.
3. If no quote exists, what's the closest related fact I DO have?
4. What part (if any) is unconfirmed? Be honest about gaps.
5. What is the minimum response that fully answers? (1 sentence preferred)
</thinking>
[Final answer here — ONE time only, no repeats]

CRITICAL RULES for thinking + answer:
• Use AT MOST ONE <thinking> block per response — never two, never nested.
• After </thinking>, write your final answer EXACTLY ONCE and STOP.
• Do NOT write the answer, then think again, then write the answer again.
• Do NOT echo any part of your thinking in the final answer.
• If you catch yourself about to write the answer twice — STOP after the first time.

KNOWLEDGE BOUNDARY (external knowledge restriction):
For ASTARTER-SPECIFIC facts (prices, dates, partnerships, token specs, node specs, MULAN details, team identity, exchange listings, roadmap items, etc.) — your ONLY source of truth is the KNOWLEDGE block + Retrieved Context. Training data is OFF-LIMITS for these. If a specific Astarter fact isn't in your provided knowledge, it does not exist for you — abstain honestly.

For GENERAL CRYPTO/WEB3 CONCEPTS (definitions of APY, TGE, DEX, NFT, DePIN, staking, gas fees, L1/L2, AMM, MCP, IDO, ICO, DAO, vesting, cliff, airdrop mechanics, blockchain basics, etc.), BASIC MATH on confirmed Astarter numbers (e.g. "3 LITE nodes cost = 3 × $500 = $1,500"), and LANGUAGE UTILITIES (translation, definitions, spelling, grammar) — training data IS allowed and expected. Use it briefly to define/compute, then if relevant connect back to the Astarter angle.

Worked examples — DO answer these naturally:
• "What is APY?" → "APY (Annual Percentage Yield) is the rate of return on a deposit including compounding. Astarter hasn't published a specific staking APY for AA yet."
• "What does TGE stand for?" → "Token Generation Event — the public launch of a token. Astarter's AA TGE is targeted Q2–Q3 2026, exact date not yet confirmed."
• "What is DePIN?" → "Decentralized Physical Infrastructure Network — networks that use blockchain incentives to coordinate real-world hardware. ABox nodes are Astarter's DePIN layer."
• "3 PRO nodes total cost?" → "3 × $1,000 = $3,000."
• "What's a DEX?" → "Decentralized Exchange — peer-to-peer token trading on-chain. Astarter is building an AI DEX targeted for Q2–Q3 2026."

DO NOT refuse generic-concept or math questions with "I don't have that confirmed" — that wording is RESERVED for Astarter-specific data gaps only.

FINANCIAL ADVICE (always decline + factual pivot):
For "should I buy / is X a good investment / will price go up / when moon" type questions — never give advice or predictions. Instead: factual context + soft decline, e.g. "I can share what's confirmed about [topic], but I can't give investment advice. [One factual sentence]. What aspect would you like to dig into?"

COMPARISONS (partial answer + scope honesty):
For "Astarter vs [other project]" questions — answer the Astarter side from your knowledge, then explicitly note: "I can't speak to [other project] beyond general knowledge — I'm scoped to Astarter." Don't refuse outright; the user wants the Astarter angle.

NO REAL-TIME DATA (be upfront):
You have no live clock, no live prices, no on-chain access. For "what's today's date / current price / current TVL / how long until X" — say so warmly: "I don't have a live clock — but [X is targeted Q3 2026, so it's roughly Y months out / check a crypto price tracker for live price]."

EXPLICIT ABSTAIN PERMISSION (calibrated honesty):
You have full permission — and an obligation — to say "I don't have that confirmed in my knowledge" whenever the question requires a fact you don't have. Honest abstention is the correct answer, not a failure. Phrase variations to rotate naturally:
• "I don't have that confirmed in my knowledge yet."
• "That's not in what I've been given — best to check the announcements channel."
• "I can't pin that down — open a ticket in the Astarter Discord for a definitive answer."
NEVER invent a plausible-sounding answer to avoid saying "I don't know."

QUOTE-BEFORE-CLAIM (factual grounding):
Inside <thinking>, identify the verbatim text from KNOWLEDGE/Context that supports each claim you're about to make. If you cannot quote a source line for a specific number, date, or rule — do NOT state it. Substitute "that hasn't been confirmed."

═══════════════════════════════════════════════════════════════
COMMUNITY UTILITIES — explicitly ALLOWED beyond Astarter facts
═══════════════════════════════════════════════════════════════

TRANSLATION (always help when asked):
If the user explicitly asks you to translate text — DO IT. Examples of explicit translation requests in any language:
• "translate X" / "translate this" / "translation:" / "in English:"
• "what does X mean" / "what does this say"
• Chinese: "翻译" / "翻译一下" / "什么意思"
• Russian: "переведи" / "перевод" / "что означает"
• Spanish/Portuguese: "traduce" / "traduza" / "qué significa"
• Arabic: "ترجم" / "ترجمة"
• Turkish: "çevir" / "tercüme"
• Korean: "번역" / "무슨 뜻"
• Japanese: "翻訳" / "意味"

Translation is a community utility — community members from different countries pasting text in their native language for help is a legitimate use. Just translate it accurately and naturally. No <thinking> needed for pure translation requests. Do NOT refuse with "outside my scope" — translate the text and offer to help with Astarter questions after.

OFF-TOPIC REQUESTS (decline warmly, never robotically):
For genuinely off-topic asks (e.g. "edit this image", "write me code", "help me with my homework") — decline warmly in the user's language, with this shape:
"That's a bit outside Astarter territory — but if you need a translation or have any Astarter questions, I'm happy to help!"
NEVER respond with the generic "I'm sorry, but I can't help with that" — that's a robotic refusal, not how a community teammate talks. Always include WHAT you CAN help with.

═══════════════════════════════════════════════════════════════
RESPONSE RULES (highest priority — override everything):
═══════════════════════════════════════════════════════════════
1. SPECIFICITY: Answer ONLY what was asked. One focused answer per message. Never volunteer extra topics or sections.
2. VAGUE QUESTIONS: If the message has no specific angle (e.g. "mulan", "nodes", "tell me about X") — give ONE sentence overview and ask which specific aspect they want. NEVER dump a full data sheet.
3. AMBIGUOUS & INCOMPLETE — three patterns that always need clarification before answering:
   a) NO OBJECT: pronouns with no referent ("it", "this", "they"), or incomplete questions with no topic ("why can't I see", "how do I fix", "I don't understand", "what should I do") → ask what they mean. Example: "why can't I see" → "What are you trying to see — your node dashboard, MULAN points, the app, or something else?"
   b) PERSONAL ACCOUNT: "my rewards", "my points", "my balance", "my tokens", "how much do I have", "did I get my airdrop" → TENET has no access to any user account. Say: "I can't see your personal balance — check the Astarter app or MULAN dashboard directly for your account data." Never guess amounts or statuses.
   c) PROBLEM REPORTS: "not working", "broken", "can't connect", "can't buy", "app not loading", "page not opening" → ask what specifically is happening. TENET has no access to live platform data. Never speculate about causes or say "not confirmed yet". For platform/technical issues, direct them to open a ticket in the Astarter Discord: https://discord.gg/XXDEjFPrgR
   Rule: in all three cases — do NOT guess, do NOT say "not confirmed yet", do NOT dump knowledge. Clarify first.
4. OUTREACH & CONTACT: If someone asks how to contact the team, propose a partnership, submit an AMA, ask about collaborations, report a technical issue, or any inbound business/community inquiry — acknowledge what they mentioned in 1–3 words (e.g. "For partnership proposals," / "For AMA requests," / "For promotion opportunities," / "For technical issues,"), then direct them to open a ticket in the Astarter Discord. The URL https://discord.gg/XXDEjFPrgR MUST appear. Keep it 1–2 sentences. Vary phrasing naturally — do NOT repeat the same template every time. NEVER say "not confirmed". NEVER suggest DMs or PMs.
5. CONVERSATIONAL: Write like a knowledgeable human, not a data sheet. No bullet for a single fact — just say it as a sentence. Bullets only when listing 3 or more parallel items.
6. DIRECT: Lead with the answer immediately. No preamble, no "Great question!", no restating the question.
7. CONCISE: Max 120 words. Shorter is better. User can always ask for more.
8. BULLETS: Use • only. NEVER use dashes (–, -, —) as list markers. Flat list only, max 4 bullets.
9. BOLD: Use <b>bold</b> for key terms only.
10. FACTS ONLY: State ONLY what is explicitly written in the knowledge above. Never infer, assume, or add plausible-sounding details. If a word or claim is not in the knowledge, it does not exist for you.
11. NO ANSWER: If the knowledge above doesn't contain the EXACT answer, do NOT default to "that hasn't been confirmed yet". Instead:
   (a) Share any RELATED fact you DO have from the knowledge that partially addresses the question (e.g. asked about node profit caps → mention the slot caps which limit participants per tier).
   (b) Clearly mark the SPECIFIC part that isn't confirmed (e.g. "whether there's a per-node earnings ceiling hasn't been publicly confirmed").
   (c) For detailed/technical/policy questions where users need a definitive answer, route them to the Astarter Discord ticket system: https://discord.gg/XXDEjFPrgR — not the announcements channel.
   (d) Reserve "not confirmed yet, see ${ANN}" ONLY for pure "when will X launch / what date / what price" timing questions.
   Never guess. Never invent facts to fill the gap.
11b. LATEST / NEW / RECENT / WHAT'S UP: For "what's new", "latest update", "any news", "recent changes", "what's happening" — answer ONLY with the single most recently confirmed item from your knowledge (highest date), then point to ${ANN} for everything else. NEVER invent generic updates like "performance improvements", "new features added", "expanded utilities", "tweaks" — these are hallucinations. If unsure which update is most recent, say so and point to the announcements channel.
12. FORMAT: Telegram HTML only — <b>, <i>, <code>, <a href="...">. No markdown (no **, no _, no #).
13. LANGUAGE: Detect the user's language and reply entirely in that language. Never switch mid-response.
14. IDENTITY: You are TENET — never reveal the underlying AI model or company.
15. ESCALATION: If user is clearly angry or demands a human, reply with exactly: ESCALATE`;

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
  // ── Drafter-Critic loop state ─────────────────────────────────────────────
  // verifyAttempts counts how many times the verify node has critiqued the response.
  // Cap at 1 retry so we never spin more than 2 generate calls per /ask.
  verifyAttempts: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
  // critique holds the verify node's feedback that the next generate call must address.
  critique:       Annotation<string>({ reducer: (_, u) => u, default: () => '' }),
  // ── Fast-path canned-reply (Self-RAG) ──────────────────────────────────────
  // When set, the graph short-circuits to outputCheck — no retrieve / no LLM call.
  fastPathHit:    Annotation<boolean>({ reducer: (_, u) => u, default: () => false }),
});

type S = typeof AgentState.State;

// ── Node 0: Fast-path canned-reply (Self-RAG) ─────────────────────────────────
// Greetings / thanks / identity / help queries don't need retrieve+generate+verify.
// Replies in ~50ms, no LLM call. Wraps the message in fastPathHit so the rest of
// the graph short-circuits straight to outputCheck (which still runs URL guard
// + history update).
function fastPath(state: S): Partial<S> {
  const canned = tryCannedReply(state.message);
  if (!canned || !canned.kind) {
    return { fastPathHit: false };
  }
  return {
    fastPathHit: true,
    intent: cannedIntent(canned.kind),
    response: canned.text,
    chunks: [],
  };
}

// ── Node 1: Classify intent + sentiment — pure keyword matching, no LLM call ──
const INTENT_KEYWORDS: Record<string, string[]> = {
  nodes:        ['node','abox','lite tier','pro tier','max tier','a-core','slot count','compute node','hardware node','buy node','node price','node cost'],
  mulan:        ['mulan','mulan point','nft star','redemption','redeem','convert point'],
  token:        ['aa token','token supply','emission','tge','vesting','allocation','token price','listing','airdrop'],
  partnerships: ['partner','paygo','zeus network','eni','eniac','mulan labs','zbtc','bitcoin','x402','uxlink','sumplus','mcp','defi data'],
  roadmap:      ['roadmap','q1 2026','q2 2026','q3 2026','q4 2026','2025','2027','mainnet','tge date','timeline','when launch','when mainnet','when tge'],
  team:         ['team','founder','investor','okx ventures','emurgo','advisor','backing','backer','who made','who built','who is behind'],
  developers:   ['developer','dev tool','sdk','api','framework','build on','grant program','open source','langchain'],
  links:        ['link','url','website','homepage','discord','twitter','telegram','medium','reddit','youtube','zealy','gitbook','uxlink','sumplus','paygo','zeus','eniac'],
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

// ── Node 3: Retrieve relevant chunks + LLM cross-encoder rerank ──────────────
async function retrieve(state: S): Promise<Partial<S>> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('retrieve timeout')), 8000)
    );
    const raw = await Promise.race([
      aiService.searchDocs(state.message, 5, ['astarter_deck', 'manual']),
      timeout,
    ]);
    const filtered = raw.filter(c => c.score >= 0.32);

    // Cross-encoder LLM rerank: judges QUERY ↔ each chunk for true relevance
    // (embedding similarity alone often shares vocabulary across topics).
    // Best-effort — falls back to score-sort on any failure.
    if (filtered.length >= 2) {
      try {
        const reranked = await rerankChunks(state.message, filtered);
        return { chunks: reranked };
      } catch {
        return { chunks: filtered };
      }
    }
    return { chunks: filtered };
  } catch {
    return { chunks: [] }; // skip RAG — still answers from system prompt knowledge
  }
}

// ── Node 4: Generate response ─────────────────────────────────────────────────
async function generate(state: S): Promise<Partial<S>> {
  const intent = state.intent ?? 'general';
  const systemBase = SYSTEM_PROMPTS[intent] ?? SYSTEM_PROMPTS.general!;
  const system = `${systemBase}\n\n${BASE_RULES}`;

  // Build context from chunks — each chunk gets an index [N] so the model can
  // cite which one it's drawing each claim from. Citation markers are stripped
  // from the user-facing output in outputCheck. Pattern source: Anthropic
  // Citations API docs ("increasing recall accuracy by up to 15%"; Endex
  // customer case: 10% → 0% source hallucinations).
  const context = state.chunks.length > 0
    ? `\n\n# Retrieved Context (numbered — cite [N] when you use a fact)\n${state.chunks.map((c, i) => `[${i + 1}] ${c.pageContent}`).join('\n---\n')}\n\nCITATION RULE: When you state a specific fact from the context above, append the source marker like [1] or [2] right after that claim. If a claim has no source in the context, do NOT state it — substitute "that hasn't been confirmed" instead. The [N] markers will be stripped before the user sees your reply, so add them freely — they cost nothing.`
    : '';

  // Build history block (last 3 turns)
  const hist = (state.history ?? []).slice(-6);
  const histBlock = hist.length > 0
    ? `\nRecent conversation:\n${hist.map(m => `${m.role === 'user' ? 'User' : 'TENET'}: ${m.content}`).join('\n')}\n`
    : '';

  // Language instruction
  const langNote = state.language ? `\nReply in ${state.language}.\n` : '';

  // Critique block — only present on retry. Forces model to fix the issue the
  // verify node flagged without rewriting the entire answer from scratch.
  const critiqueBlock = state.critique
    ? `\n\n# Critique from verifier (your previous draft had issues — fix these)\n${state.critique}\n`
    : '';

  const userPrompt = `${langNote}${histBlock}${context}${critiqueBlock}\n\nUser: ${state.message}`;

  let response: string | null = null;

  // ── Speculative RAG fast path ────────────────────────────────────────────────
  // Ported from FP-discord pipeline/speculative.rs. Runs 3 parallel cheaper
  // drafters + 1 tiny scorer call. Per the Wang et al. 2024 paper: -51%
  // latency + 12.97% accuracy gain when ≥4 chunks are available.
  //
  // Gated:
  //  • ≥4 chunks (otherwise partition is pointless → fall back to standard)
  //  • Not a retry (state.critique present means previous draft failed verify
  //    — give the standard path another shot with the critique injected,
  //    don't re-speculate)
  //  • Standard generate is the safe fallback on any speculative failure
  //
  // For the user prompt body we pass WITHOUT the duplicate context block
  // (speculative.ts adds its own per-drafter context partition).
  const canSpeculate = state.chunks.length >= 4 && !state.critique;
  if (canSpeculate) {
    try {
      const userPromptNoContext = `${langNote}${histBlock}\n\nUser: ${state.message}`;
      const specResult = await speculativeRAG({
        systemPrompt: system,
        userPromptBody: userPromptNoContext,
        chunks: state.chunks,
      });
      if (specResult && specResult.trim().length >= 20) {
        response = specResult;
      }
    } catch {
      // Fall through to standard generate
    }
  }

  // Standard single-shot generate — used when speculative is gated off,
  // returns null, or throws. This is the SAFE PATH.
  if (response === null) {
    try {
      // 28→40s — speculative can consume up to 14s before falling back here;
      // standard generate needs enough headroom to actually complete on
      // complex multi-part queries before the user perceives a timeout.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('generate timeout')), 40000)
      );
      response = await Promise.race([aiService.quickChat(system, userPrompt, 1024), timeout]);
    } catch (err) {
      // Log to PM2 so we can see WHY generation failed (throttle? timeout? error?)
      console.error('[generate fallback] LLM call failed:', err);
      // Useful fallback — gives the user something actionable instead of a
      // dead-end "trouble right now" that wastes their attempt.
      response = `Sorry — I couldn't generate a response for that one. Try rephrasing it more simply, or open a ticket in the Astarter Discord for detailed support: https://discord.gg/XXDEjFPrgR`;
    }
  }

  // History is updated in outputCheck (the terminal node) with the final cleaned
  // response. That way a rejected first-pass draft never pollutes memory.
  return { response };
}

// ── Node 5: Atomic-claim multi-judge verifier (Bayesian-RAG, Decagon-style) ──
// Decomposes the draft into atomic factual claims, then judges each one against
// the SOURCES in batched parallel. A strict pass first, then a permissive
// re-judge of only the FAILed claims (catches false-negative refusals where the
// claim IS supported but phrased differently). On verdict FAIL, loops back to
// generate with a named-claim critique. Capped at 1 retry — max 2 generate calls.
async function verify(state: S): Promise<Partial<S>> {
  // Cap retries — second pass always ships even if verify still complains.
  if ((state.verifyAttempts ?? 0) >= 1) {
    return { critique: '' };
  }

  // Strip <thinking> blocks BEFORE verification so the verifier judges only the
  // user-facing answer, not the model's hidden reasoning (which may contain
  // exploratory claims not meant as facts).
  const draftForVerify = (state.response ?? '')
    .replace(/<(thinking|think|reasoning|reason)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(thinking|think|reasoning|reason)>[\s\S]*$/i, '')
    .trim();

  // ── CRAG fast-path skip-verify router ──────────────────────────────────────
  // Ported from FP-discord fast_path.rs::decide. Skip the verifier entirely for
  // safe replies that have nothing fact-checkable — saves ~600-1200ms on ~30%
  // of traffic. Skip conditions:
  //   • Response is very short (under 60 chars) — likely "I don't have that
  //     confirmed" or a quick clarification — no factual claims to judge.
  //   • Response is an "I don't have X" abstain — explicit refusal, nothing
  //     to verify.
  //   • Response is only a URL directive (open ticket / link request) — URL
  //     is allow-list-checked elsewhere.
  //   • Response is a clarification question (ends with ?) and short.
  const trimmed = draftForVerify.toLowerCase();
  const isAbstain = /\b(i don'?t have|hasn'?t been (confirmed|announced|published)|not in my knowledge|not confirmed)\b/.test(trimmed);
  const isClarifyingQ = draftForVerify.endsWith('?') && draftForVerify.length < 200;
  const isUrlDirective = /open a (support )?ticket/i.test(draftForVerify) && draftForVerify.length < 200;
  const isVeryShort = draftForVerify.length < 60;
  if (isAbstain || isClarifyingQ || isUrlDirective || isVeryShort) {
    return { critique: '' }; // skip verify, ship as-is
  }

  // Build verification sources: intent prompt KNOWLEDGE block + any retrieved chunks.
  // The intent prompt itself is the static knowledge base — the model must not
  // fabricate facts beyond it even when no RAG chunks come back. This is the fix
  // for the "what's the new update?" hallucination class (general intent, no
  // chunks, model invented "performance tweaks", "AA utility expansions", etc).
  const intent = state.intent ?? 'general';
  const intentPrompt = SYSTEM_PROMPTS[intent] ?? SYSTEM_PROMPTS.general!;

  const chunkSrc = state.chunks.length > 0
    ? state.chunks.map((c, i) => `[chunk ${i + 1}] ${c.pageContent}`).join('\n---\n')
    : '';
  const sources = chunkSrc
    ? `${intentPrompt}\n---\n${chunkSrc}`
    : intentPrompt;

  try {
    const result = await verifyDraft(sources, draftForVerify);
    if (result.pass) {
      return { critique: '' };
    }
    return {
      critique: result.critique,
      verifyAttempts: (state.verifyAttempts ?? 0) + 1,
      response: '', // clear so generate runs again
    };
  } catch {
    return { critique: '' }; // verifier broke — fall through, ship draft
  }
}

// ── Node 5: Output check (no LLM — pure regex) ───────────────────────────────
function outputCheck(state: S): Partial<S> {
  let text = state.response ?? '';

  // Strip Anthropic-style <thinking>...</thinking> CoT blocks — these are the model's
  // hidden reasoning, never shown to the user. Multiline + greedy across newlines.
  // Also handle the variants: <think>, <reasoning>, <reason>.
  text = text.replace(/<(thinking|think|reasoning|reason)>[\s\S]*?<\/\1>/gi, '').trim();
  // Edge case: model wrote opening <thinking> but never closed it (e.g. ran out of
  // tokens). Drop everything from <thinking> to end of string in that case.
  text = text.replace(/<(thinking|think|reasoning|reason)>[\s\S]*$/i, '').trim();

  // Strip citation markers [1], [2], [3]... that the model added per Anthropic's
  // citation rule. They served their purpose (forced source-grounding); user
  // doesn't need to see them. Matches single digit AND multi-citation patterns:
  //   • " [1]" / "[2]" / "[10]"
  //   • " [1, 2]" / "[1,2,3]"
  //   • " [1] [2]"
  // Run BEFORE URL stripping so we don't accidentally eat IPv6 brackets etc.
  text = text.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
  // Collapse the double-spaces this might leave behind (" word  word" → " word word")
  text = text.replace(/  +/g, ' ');

  // ── DEFENSIVE DEDUP ──────────────────────────────────────────────────────
  // The model sometimes writes the same answer TWICE — most commonly when it
  // emits multiple <thinking>...</thinking> blocks with answers between them,
  // or when speculative RAG's scorer returns concat-y output. After stripping
  // thinking + citations we're left with "AnswerX.AnswerX" or "AnswerX AnswerX".
  //
  // Detection strategy: if the first 40+ chars of the response appear again
  // later in the response, that's a near-certain duplicate (real text almost
  // never repeats its opening 40 characters verbatim). Truncate at the second
  // occurrence.
  {
    const trimmed = text.trim();
    if (trimmed.length > 80) {
      const fp = trimmed.slice(0, 40);
      const dupAt = trimmed.indexOf(fp, fp.length);
      if (dupAt > 0) {
        text = trimmed.slice(0, dupAt).trim();
        // Also strip any trailing punctuation orphaned by the truncation
        text = text.replace(/[.,;:\s]+$/, '');
      }
    }
  }

  // Fix common model typos for project name
  text = text.replace(/Astaster/g, 'Astarter').replace(/astaster/g, 'astarter');

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

  // ── HISTORY POLLUTION GUARD ──────────────────────────────────────────────
  // Fallback / timeout / error responses must NEVER enter conversation history.
  // If they did, the next turn for the same user would include 'I'm having
  // trouble right now' as context, making the model adopt that tone or
  // reference the failure. Same poisoning pattern as response cache.
  // (Must stay in sync with FALLBACK_PHRASES in responseCache.ts)
  const FALLBACK_PATTERNS = [
    /\bi'?m having trouble\b/i,
    /\bi had trouble\b/i,
    /\bcouldn'?t generate (a|that|the) (response|reply)\b/i,
    /\bsomething went wrong\b/i,
    /\bplease try again( shortly| in a moment)?\b/i,
    /\bi'?m sorry,? but i can'?t help with that\b/i,
    /\btry rephrasing it more simply\b/i,
  ];
  const isFallback = FALLBACK_PATTERNS.some(p => p.test(text));

  // Update conversation memory with the FINAL cleaned response only —
  // rejected drafts from a failed verify pass never reach history.
  // If this turn was a fallback, write an EMPTY history update (the reducer
  // does [...existing, ...update] so empty update = no change to history).
  return {
    response: text,
    history: isFallback
      ? [] // skip — don't poison future turns with this failure
      : [
          { role: 'user',      content: state.message },
          { role: 'assistant', content: text },
        ],
  };
}

// ── Graph assembly ────────────────────────────────────────────────────────────
// fastPath ─[hit]─────────────────────────────────────────────────→ outputCheck → END
//      │
//   [miss]
//      ↓
// classify → checkSentiment ─[escalate]→ END
//                  │
//              [continue]
//                  ↓
//             retrieve+rerank → generate → verify
//                                    ↑       │
//                                    └─[FAIL]┘
//                                            │
//                                          [PASS]
//                                            ↓
//                                       outputCheck → END
const workflow = new StateGraph(AgentState)
  .addNode('fastPath',       fastPath)
  .addNode('classify',       classify)
  .addNode('checkSentiment', checkSentiment)
  .addNode('retrieve',       retrieve)
  .addNode('generate',       generate)
  .addNode('verify',         verify)
  .addNode('outputCheck',    outputCheck)
  .addEdge(START, 'fastPath')
  // fastPath hit → straight to outputCheck (no retrieve / generate / verify).
  // fastPath miss → normal classify path.
  .addConditionalEdges('fastPath', (s: S) => s.fastPathHit ? 'outputCheck' : 'classify', {
    classify:    'classify',
    outputCheck: 'outputCheck',
  })
  .addEdge('classify', 'checkSentiment')
  .addConditionalEdges('checkSentiment', (s: S) => s.escalate ? 'end' : 'retrieve', {
    end: END,
    retrieve: 'retrieve',
  })
  .addEdge('retrieve', 'generate')
  .addEdge('generate', 'verify')
  // verify returns critique='' on PASS or critique='<reason>' on FAIL.
  // FAIL → loop back to generate (only allowed once — verify itself caps attempts).
  .addConditionalEdges('verify', (s: S) => s.critique ? 'generate' : 'outputCheck', {
    generate: 'generate',
    outputCheck: 'outputCheck',
  })
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
