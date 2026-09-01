# Beacon 0G — HISTORY

Living engineering log. **No secrets.** Plan source: `D:\route\Flare\0g\BEACON_0G_EXECUTION_PLAN_V2\BEACON_0G_EXECUTION_PLAN_V2.md` (untouched). Original Flare Beacon at `D:\route\Flare\beacon` was not modified.

Public repo: https://github.com/goat-dev8/beacon-0g  
Chain: 0G Aristotle **16661** (`eth_chainId` `0x4115`). Unit of account: **native 0G**.

---

## What the product is

Beacon stays Beacon: tell it what you want, it quotes in **0G**, policy + TeeML decide ALLOW/DENY, work runs on 0G Compute + Storage, you pay in 0G or you were not charged. Surfaces: Flow `/flow`, Jobs `/flow/desk`, Safe `/flow/security`, MCP `/flow/mcp`, public `/verify/:id`.

Not: chatbot, DEX, agent marketplace, USDT0 desk, Flare FAssets/FTSO/LayerZero.

---

## Timeline (from begin to now)

### 0. Research → V2 plan (untouched)

V1 mapped Flare Beacon onto 0G but still thought in USD/USDC.e. V2 (2026-09-01) locked the economy to **native 0G**, deleted the FX oracle, pinned **Zia** for swaps (fail-closed), TeeML independent of Router `verify_tee`, Storage turbo evidence, Job Escrow lock/refund/release, ERC-8004 if live.

Constraints that stood: no mocks, no Groq/OpenAI fallbacks, no simulated TEE, no Flare adapters, no secrets in git, leave original `beacon` alone.

### 1. Scaffold (plan hour 0–4)

New public monorepo `beacon-0g`. Workspaces: `packages/shared|quote|compute|tee|storage|swap|receipts|execution|mcp`, `packages/contracts` (Foundry), `apps/api`, `apps/web`, `services/settler`. Guard script bans `GROQ_API_KEY`, `InMemoryStorage`, `SIMULATED_TEE`, `api.openai.com`. Native vault Solidity + tests exist.

### 2. Contracts (plan hour 4–12) — Aristotle 16661

| Contract | Address |
|---|---|
| BeaconJobEscrow | `0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566` |
| BeaconReceiptRegistry | `0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887` |
| BeaconVaultFactory | `0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1` |
| Demo Safe | `0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30` |

Vault wealth = native 0G + W0G. Wrap is not spend. Executor-only `execute`. Escrow owner `refund`/`release`. Factory allowlists W0G wrap/approve, escrow `lockNative`, Zia `exactInputSingle`.

Mainnet txs (see `PROOF.md`): deploy escrow/registry/factory, `createSafe`, deposit 0.05 0G.

### 3. Core packages (plan hour 12–34)

- **Quote:** live `GET /v1/models`, neuron `pricing`, `pricing_usd` display-only.
- **Compute:** Router `chat/completions` + async `z-image-turbo`. No fallbacks.
- **Tee:** `processResponse` fail-closed + independent EIP-191 (`getService` → provider `/v1/proxy/signature/{chatID}` → recover vs on-chain TEE signer). Router `verify_tee` is not proof.
- **Storage:** encrypt + turbo upload. Failure fails the job (refund path).
- **Swap:** Zia QuoterV2 + `exactInputSingle` only. Thin book refused. JAINE/SparkDEX/OFT throw `NOT_AVAILABLE`.
- **Receipts:** `amount0g`, `storageRoot`, `teeSigner`, `quoteHash`.

### 4. Apps (plan hour 34–42)

API (Fastify, hosted on Render): catalog `/v1/models`, `/v1/quote`, jobs lock/run/refund/release, `/v1/verify/:id` (on-chain receipt is authoritative), Flow chat, Zia quote/build, Safe session (`chain:16661`), vault status/prepare, Zia execute from Safe, honest OFT refuse.

Web (Vite, hosted on **Vercel**): Flow, Jobs, Safe, `/verify`. SPA rewrite. Wallet via Reown on Aristotle. Production SPA talks to `https://beacon-0g-api.onrender.com` (`apps/web/.env.production` + `apiBase()` fallback). No Compute/settler/DB secrets on Vercel.

### 5. Live 0G proofs (not mocks)

Recorded in `PROOF.md`:

- Compute: `glm-5.3-flash` with `ZG-Res-Key`; image job `z-image-turbo`.
- TeeML: `processResponse: true` **and** `eip191Ok: true` (`npm run smoke:tee`). Recovered signer `0x4C1b546f5Fc11A9c2428eaFEd1D951Aa13C17ee8`.
- Storage root `0xefae47d0…` txSeq `211697`.
- Escrow lock / refund / release txs.
- Receipt registry record for job `0xb1c5ac5a…`.
- Zia wrap + approve + `exactInputSingle`.
- ERC-8004 `register()` agentId `3531902`.

### 6. Hosting (2026-09-02)

| Surface | Where | URL |
|---|---|---|
| API | Render `beacon-0g-api` (kept, not suspended) | https://beacon-0g-api.onrender.com |
| Web | **Vercel** project `beacon-0g` | https://beacon-0g.vercel.app |
| Render static web | `beacon-0g-web` **suspended** | do not use |
| Original Flare Beacon | Render `beacon-api` etc. | **untouched** |

Vercel project: https://vercel.com/goats-projects-3f023cc9/beacon-0g  
Build: `npm install --legacy-peer-deps` then `npm run build -w @beacon/web`. Output `apps/web/dist`. Root directory = repo root (not `apps/web`). SPA rewrite `/(.*) → /index.html`.

Web env on Vercel is **public `VITE_*` only**: `VITE_API_URL`, `VITE_RPC_URL`, `VITE_CHAIN_ID`, escrow/registry/factory/treasury/demo Safe, Reown project id. Settler keys, Compute key, DB, Redis, GitHub/Render/Vercel tokens stay off the frontend.

First git production deploy baked contract fallbacks but **not** the API host (empty `VITE_API_URL` → same-origin `/v1/*` 404 on Vercel). Fix: committed `apps/web/.env.production` plus `apiBase()` production fallback to the Render API.

### 7. Browser E2E (Render API + hosted web)

Proven against the API and (pre-Vercel) hosted Flow:

- Landing: 0G / Aristotle 16661, not Flare.
- Flow: Zia quote 0.2 0G → USDC.e; unconstrained transfer **Blocked before funds moved.**
- Cheap catalog quote: `glm-5.3-flash` lock 0.001 0G.
- Image quote: `z-image-turbo`.
- `/verify/0xb1c5ac5a…`: on-chain storage root, ALLOW, TEE signer, recorder. No wallet.

Re-check after Vercel API-base fix: SPA `/`, `/flow`, `/verify/:id` must call `beacon-0g-api.onrender.com`, not Vercel origin.

### 8. Git

Public `main` at https://github.com/goat-dev8/beacon-0g.git. CI copy lives at `scripts/github-ci.yml` because the GitHub PAT used for push lacked `workflow` scope (`.github/workflows` is not pushed with that token).

---

## V2 P0 — done vs not

P0 from the plan: *native vault+factory, escrow refund/release, TeeML processResponse, Storage turbo, 0G quotes from `pricing` neurons, Flow chat, image job, receipt registry, `/verify`, Zia exactInputSingle fail-closed, ERC-8004 register if ABI works, Foundry+CI, public git, mainnet txs, PROOF.md.*

| P0 item | Status | Evidence |
|---|---|---|
| Native vault + factory | **DONE** | Deployed; demo Safe funded |
| Escrow lock / refund / release | **DONE** | `PROOF.md` txs |
| TeeML `processResponse` | **DONE** | smoke + live chat |
| Independent EIP-191 | **DONE** | `npm run smoke:tee` `eip191Ok: true` |
| Storage turbo | **DONE** | root + txSeq |
| Quotes from live catalog neurons | **DONE** | `/v1/models`, Flow cheap/image |
| Flow UI | **DONE** | Vercel web + Render API |
| Image (`z-image-turbo`) | **PARTIAL** | Live Router image job + Flow **quote**; hosted lock→run→release of a new image through the UI is not yet a second public receipt |
| Receipt registry + `/verify` | **DONE** | UI shows on-chain receipt without API memory |
| Zia `exactInputSingle` fail-closed | **DONE** | Mainnet swap txs; thin-book refuse |
| ERC-8004 register | **DONE** | agentId `3531902` |
| Foundry tests | **DONE** | `forge test` in repo |
| GitHub Actions green | **NOT DONE** | Workflow file not on GitHub (`workflow` token scope). Local: vitest + guard pass |
| Public git | **DONE** | goat-dev8/beacon-0g |
| Mainnet txs + PROOF.md | **DONE** | this repo |
| Hosted job lock→run from Flow UI | **NOT DONE** | Escrow proven via smoke; Flow currently quotes/denies/swaps; full UI pay-and-run loop still needs a wallet session on Vercel |
| ≤3 min demo + X post | **NOT DONE** | Plan hour 42–48 |
| CI on GitHub | **NOT DONE** | Same as GHA |

### Definition of Done (plan)

| # | Requirement | Now |
|---|---|---|
| 1 | User funds Safe with native 0G | **DONE** (demo wallet deposit tx) |
| 2 | Caps work | **DONE** on-chain; Flow deny path proven in UI |
| 3 | Job lock/refund/release visible | **DONE** on explorer; not yet a second UI-driven job |
| 4 | Quotes in 0G from live `pricing` | **DONE** |
| 5 | TeeML independently verifiable | **DONE** |
| 6 | Storage root on storagescan | **DONE** |
| 7 | Image via z-image-turbo only | **DONE** for generation path; video off |
| 8 | One real Zia swap or honest refuse | **DONE** both |
| 9 | `/verify` without trusting API | **DONE** |
| 10 | ERC-8004 used or honest skip | **DONE** (register) |
| 11 | No production mocks/fallbacks | **DONE** (guard + fail-closed) |
| 12 | CI green | **NOT** on GitHub Actions |
| 13 | Public in-window git | **DONE** |
| 14 | ≤3 min demo + X post | **NOT DONE** |
| 15 | Video/x402/Agentic ID not over-claimed | **DONE** (flags off; Galileo Agentic ID not claimed) |

---

## V2 P1 / P2 / P3 — still not the tape

**P1 (not done, demo survives):** MCP grants with 0G scopes (API stubs health/empty grants only), why-denied panel polish, pause-all UX wired to vault, ERC-8004 **feedback** after jobs, Direct Ledger `refund` ops, footprint.

**P2 (intentionally off / not claimed):** x402 USDC.e, video (`ENABLE_VIDEO=false`), extra JobRegistry contract, Galileo Agentic ID.

**P3 (will not do):** DA, chain 7857, Payment Layer as user wallet, JAINE, clone TradeGPT, LP zaps, Robinhood.

**Honest leftover naming:** some policy fields still say `*Usdt0` in types while the UI unit is 0G. Dead Flare card types early-return “Not on 0G”.

**Plan remaining unknowns (research, not blockers for hosted web):** Path B wrap without `WETH9()`, first paid Router invoice vs catalog neuron, z-image `processResponse` with empty content, AKINDO submit instant, Payment Layer vs Direct-only for TeeML.

---

## Still not done (actionable)

1. GitHub Actions: push `.github/workflows` with a PAT that has `workflow` scope; get CI green on GitHub.
2. Full Flow UI lock → run → release (wallet session on Vercel) so a **second** public receipt is created from the hosted UI, not only smoke txs.
3. ≤3 minute demo + X post `#0GBridge #BuildOn0G` (plan hour 42–48).
4. P1 polish listed above.
5. Rename leftover `*Usdt0` fields to 0G.
6. Do **not** put web back on Render. Do **not** put settler/Compute secrets on Vercel.

---

## Reproduce (no secrets in git)

```bash
npm install --legacy-peer-deps
npm test
npm run smoke:mainnet
npm run smoke:storage-swap
npm run smoke:erc8004
npm run smoke:tee
```

Live API: https://beacon-0g-api.onrender.com/health  
Live web: https://beacon-0g.vercel.app  
Live verify: https://beacon-0g.vercel.app/verify/0xb1c5ac5abf0c7ff569c09939ce0620390fbbb41cc8ae400278af04070696ba77
