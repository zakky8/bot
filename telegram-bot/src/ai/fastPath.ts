/**
 * Self-RAG canned-reply fast path.
 *
 * Pattern (ported from FP-discord/crates/ai/src/pipeline/fast_path.rs):
 *   Greetings / thanks / identity / "what can you do" questions account for
 *   ~15-25% of community message volume. Running the full LangGraph
 *   (classify → retrieve → generate → verify → outputCheck + a Bedrock LLM
 *   call) on "hi" costs ~2-5 s and ~2k input tokens — for an answer that's
 *   a constant string.
 *
 * This module returns a deterministic canned reply when the message clearly
 * matches one of those buckets. The graph short-circuits to outputCheck
 * (which still runs ALLOWED_URLS guard + history update) and skips the LLM.
 *
 * What is NOT canned:
 *   • Anything containing a topic keyword (node, mulan, token, etc.) — even
 *     "hi, when is TGE?" → run full pipeline.
 *   • Anything > 6 words — likely carries an actual question.
 *   • Anything ending with a question mark on a single-word message
 *     (e.g. "really?" — needs context).
 */

const GREETING_TOKENS = new Set([
  'hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'heyy', 'yo', 'sup', 'wassup',
  'hola', 'salam', 'salaam', 'salams', 'salem', 'привет', 'здравствуйте',
  'こんにちは', '你好', 'مرحبا', 'merhaba', 'selam', 'ola', 'olá',
  'gm', 'gn', 'gmgm', 'morning', 'evening', 'afternoon',
]);

const THANKS_TOKENS = new Set([
  'thanks', 'thank', 'thx', 'thnx', 'ty', 'tysm', 'cheers',
  'спасибо', 'gracias', 'merci', 'shukran', 'tesekkurler', 'teşekkürler',
  'ok', 'okay', 'okk', 'okayy', 'k', 'kk', 'cool', 'nice', 'good', 'great',
  'got it', 'gotit', 'understood', 'noted', 'ack',
  '👍', '🙏', '👌', '💯', '🔥', '❤️', '🚀',
]);

const IDENTITY_PATTERNS: RegExp[] = [
  /\b(who|what)\s+(are|r)\s+(you|u)\b/i,
  /\bwhat'?s?\s+your\s+name\b/i,
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bwhat\s+do\s+you\s+do\b/i,
  /\bare\s+you\s+(a\s+)?(bot|ai|human|real)\b/i,
  /\bwho\s+made\s+you\b/i,
];

const HELP_PATTERNS: RegExp[] = [
  /^\/?help\b/i,
  /^how\s+(do|can|to)\s+(i|u|you)\s+use\s+(this|tenet|the\s+bot)\b/i,
  /^what\s+commands\b/i,
];

/** Topic keywords — if ANY of these appear, do NOT canned-reply. */
const TOPIC_GUARD = /\b(node|abox|mulan|aa|token|tge|launch|airdrop|paygo|zeus|eni|uxlink|sumplus|roadmap|mainnet|partner|invest|okx|emurgo|advisor|api|sdk|grant|framework|develop|build|astarter|link|website|discord|telegram|reddit|medium|twitter|youtube|zealy|presale|stake|reward|profit|earn|cap|slot|tier|price|allocation|emission|vesting|cliff|supply|nft|claim|redeem|kyc|verif|whitelist|ido|swap)\b/i;

export type CannedKind = 'greeting' | 'thanks' | 'identity' | 'help' | null;

export interface CannedReply {
  kind: CannedKind;
  text: string;
}

/**
 * Try to match a canned reply. Returns null if the message needs the full pipeline.
 */
export function tryCannedReply(message: string): CannedReply | null {
  const raw = message.trim();
  if (!raw) return null;

  // Drop topic-bearing messages immediately — even "hi how do I buy a node?"
  if (TOPIC_GUARD.test(raw)) return null;

  // Short-token greeting / thanks bucket
  const lower = raw.toLowerCase().replace(/[!.,?]+$/g, '').trim();
  const words = lower.split(/\s+/);
  const isShort = words.length <= 4;

  // Greetings (1-3 words)
  if (isShort && words.every(w => GREETING_TOKENS.has(w))) {
    return {
      kind: 'greeting',
      text: `Hey! I'm TENET, Astarter's community assistant. Ask me about ABox nodes, the AA token, MULAN points, partnerships, the roadmap — anything Astarter.`,
    };
  }

  // Thanks / acknowledgments (1-3 words)
  if (isShort && words.every(w => THANKS_TOKENS.has(w))) {
    return {
      kind: 'thanks',
      text: `Anytime! 🙌 Anything else I can help with?`,
    };
  }

  // Identity questions
  if (IDENTITY_PATTERNS.some(p => p.test(raw)) && raw.length < 60) {
    return {
      kind: 'identity',
      text: `I'm TENET — Astarter's community AI assistant. I can answer questions on ABox nodes, the AA token, MULAN points, partnerships, the roadmap, team & investors, and developer resources. What would you like to know?`,
    };
  }

  // /help-style queries
  if (HELP_PATTERNS.some(p => p.test(raw)) && raw.length < 80) {
    return {
      kind: 'help',
      text: `Just type your question — I'll answer in plain English. Examples:\n• "What are the ABox node tiers?"\n• "How do I earn MULAN points?"\n• "When is TGE?"\n• "Show me the announcements link"\n\nUse /ask &lt;question&gt; in groups, or just message me directly in DM.`,
    };
  }

  return null;
}

/** Map canned kind → an intent string for cache + follow-up routing. */
export function cannedIntent(kind: Exclude<CannedKind, null>): string {
  switch (kind) {
    case 'greeting':
    case 'thanks':
    case 'identity':
    case 'help':
      return 'general';
  }
}
