# Astarter Partnerships

Last updated: May 2026

Astarter has 6 active partnerships. Add new ones below when announced.

---

## MULAN Labs
- **Announced:** May 2026
- **What they do:** Community rewards and referral platform — users earn MULAN Points through referrals and NFT holding.
- **Integration with Astarter:** MULAN point holders are eligible for an AA token airdrop from Astarter + node fee sharing + priority launchpad access.
- **Links:** https://mulan.meme

---

## PayGo
- **Announced:** April 2026
- **What they do:** AI-native x402 payment protocol — enables AI agents to pay each other autonomously on-chain.
- **Integration with Astarter:** Astarter AI agents will use PayGo's payment rails for autonomous coordination and value exchange.
- **Links:** https://www.paygo.ac | Twitter: https://x.com/PayGo402 | Telegram: https://t.me/Paygo_eni

---

## Zeus Network
- **Announced:** April 2026
- **What they do:** Bitcoin liquidity layer — zBTC is a 1:1 BTC-pegged token that brings Bitcoin liquidity cross-chain.
- **Integration with Astarter:** zBTC flows into the Astarter ecosystem, enabling Bitcoin-backed DeFi activity on Astarter's platform.
- **Links:** https://zeusnetwork.xyz | Twitter: https://x.com/ZeusNetworkHQ | Discord: https://discord.gg/zeusnetwork

---

## ENI / ENIAC Network
- **Announced:** April 2026
- **What they do:** Enterprise modular Layer 1 blockchain focused on cross-chain DeFi and institutional use cases.
- **Integration with Astarter:** Cross-chain DeFi collaboration and co-incubation of projects within both ecosystems.
- **Links:** https://eniac.network | Docs: https://docs.eniac.network | Twitter: https://x.com/ENI__Official | Telegram: https://t.me/ENI_Channel | Community: https://t.me/ENI_Community

---

## UXLINK
- **Announced:** May 2026
- **What they do:** Leading Web3 social platform — connects global users, communities, and builders to accelerate Web3 participation.
- **Integration with Astarter:** Astarter's AI-native infrastructure integrates with UXLINK's social ecosystem to enable autonomous coordination, social growth, and on-chain activity at scale.
- **Links:** https://x.com/UXLINKofficial | https://uxlink.io | https://linktr.ee/uxlink_official

---

## SumPlus
- **Announced:** May 2026
- **What they do:** DeFi real-time data layer — provides top authoritative DeFi data (TVL, protocol core indicators, heterogeneous chain ecology, cross-chain panoramic analysis) accessible via MCP (Model Context Protocol).
- **Integration with Astarter:** Astarter AI Agents can call SumPlus DeFi data with one click through MCP. SumPlus delivers the "data vision" layer that complements Astarter's "on-chain execution ability," enabling autonomous agents to monitor and act on-chain 24/7. Positioned as DeFi Data Layer × AI Agent Execution Layer × Astarter — the DePIN/DeFAI bottom layer of the Web4 decentralized financial OS.
- **Links:** https://www.sumplus.xyz

---

## How to add a new partnership

1. Add a new `##` section to this file following the format above.
2. Update `agent.ts` → `SYSTEM_PROMPTS.partnerships` knowledge block.
3. Update `agent.ts` → `INTENT_KEYWORDS.partnerships` (add partner name keyword).
4. Update `agent.ts` → `ALLOWED_URLS` (add official links).
5. Update `shared/src/services/ai/AIService.ts` → `INTENT_EXPERT_BLOCKS.partnerships` and `ALLOWED_URLS`.
6. Build + commit + deploy.
