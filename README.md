# Beacon 0G

[![CI](https://github.com/goat-dev8/beacon-0g/actions/workflows/ci.yml/badge.svg)](https://github.com/goat-dev8/beacon-0g/actions/workflows/ci.yml)

**Spend-bounded AI execution on 0G Aristotle.** Intent enters Flow or MCP. Policy, TeeML, and a Beacon Safe decide whether native 0G may move. 0G Compute and 0G Storage do the work. Settlement, receipts, Merkle anchors, and ERC-8004 reputation make the run inspectable.

Live web: [https://beacon-0g.vercel.app](https://beacon-0g.vercel.app)  
Live API: [https://beacon-0g-api.onrender.com](https://beacon-0g-api.onrender.com)  
Source: [https://github.com/goat-dev8/beacon-0g](https://github.com/goat-dev8/beacon-0g)

## One-line positioning

Beacon is the execution layer that lets an AI agent use 0G — Compute, Storage, Zia, and the chain — without ever holding the private key.

## How to use Beacon

Money path on the Safe page: **Wallet → Beacon Safe → Policy → AI → Execution → Receipt → Wallet**.

Native 0G: [get.0g.ai](https://get.0g.ai/). Network: **0G Aristotle**, chain id **16661**, RPC `https://evmrpc.0g.ai`. Reown never asks for a seed phrase.

| Step | Where | What you do |
|---|---|---|
| 1 | [get.0g.ai](https://get.0g.ai/) | Hold native 0G on Aristotle. |
| 2 | [/start](https://beacon-0g.vercel.app/start) | Walk the money path (wallet, Safe, policy, TeeML, lock, execute, receipt). |
| 3 | Any page → **Connect** | Connect a wallet on **0G Aristotle (16661)**. Wrong network is refused. |
| 4 | [/flow/security](https://beacon-0g.vercel.app/flow/security) | **Create Beacon Safe** (`BeaconVaultFactory.createSafe`). One Safe per owner. |
| 5 | Same page | **Deposit** native 0G into the Safe. Your wallet balance stays yours until you deposit. |
| 6 | Same page | **Unlock Beacon Agent**. One wallet signature binds this browser tab. It is **not** a transaction and it does **not** move funds. After that, the allowlisted executor submits approved Safe actions without a MetaMask prompt per job. |
| 7 | Same page | **Set spending policy**: per-tx cap, rolling window budget, session length, pause. Owner-only. Anyone can deposit; only the owner sets policy, withdraws, or pauses. |
| 8 | [/flow](https://beacon-0g.vercel.app/flow) | Talk in Flow. Chips fill real intents: image, swap, inspect, analyze, bridge, cheap model, research, deny, history. |
| 9 | [/flow/desk](https://beacon-0g.vercel.app/flow/desk) | Jobs desk: Image, Research, Coding, Documents, Analysis. Quote in neurons → lock → Compute → Storage → release or refund. |
| 10 | [/flow/mcp](https://beacon-0g.vercel.app/flow/mcp) | **Connect Agent**. Scoped MCP grant (default 5 0G / tx, 20 0G / day, 7-day TTL). Cursor / Claude never receive the private key. |
| 11 | [/verify/:id](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f) | Open the forensic receipt. Browser `eth_call`s the registry. |

Unlock once. Then Flow and Jobs can lock from the Safe inside policy. Pause anytime. Withdraw anytime.

```
Connect wallet on 16661
  → Create Beacon Safe
  → Deposit native 0G
  → Unlock agent session
  → Set policy
      → Flow  ─┐
      → Jobs  ─┼→ Verify
      → MCP   ─┘
```

## Product map

| Surface | URL | What it is |
|---|---|---|
| Landing | [/](https://beacon-0g.vercel.app/) | Positioning and entry |
| Get started | [/start](https://beacon-0g.vercel.app/start) | Guided money path |
| **Flow** | [/flow](https://beacon-0g.vercel.app/flow) | Chat desk. Intent → quote → policy → TeeML → execute → History |
| **Jobs** | [/flow/desk](https://beacon-0g.vercel.app/flow/desk) | Catalog jobs with lock, proof, View result |
| **Safe** | [/flow/security](https://beacon-0g.vercel.app/flow/security) | Create, deposit, unlock session, policy, pause, withdraw |
| **Agents** | [/flow/mcp](https://beacon-0g.vercel.app/flow/mcp) | MCP grants, mcp.json, OAuth Authenticate, revoke |
| Verify | `/verify/:jobId` | Public forensic proof |
| Agent card | [/.well-known/agent-card.json](https://beacon-0g.vercel.app/.well-known/agent-card.json) | ERC-8004 registration v1 |

## Flow — what you can do

Flow is the primary desk. Type a sentence or tap a chip. The model does not decide spend. Preflight, Safe policy, and TeeML do.

| Chip | Example prompt | What Beacon does |
|---|---|---|
| Image | Generate a lighthouse image and save the proof | Quote `z-image-turbo`, lock 0G, Compute, Storage, `/verify` |
| Swap | Swap 0.2 0G to USDC.e | Live Zia quote; Safe wrap → approve → `exactInputSingle` if ALLOW |
| Reverse | Swap 0.001 USDC.e to 0G | Live quote; Safe **execution** refused (`wealth()` is native+W0G) |
| Swap book | What can I swap? | Zia tokens with a live factory pool |
| Inspect | Inspect an Aristotle address | Live RPC bytecode, balance, selector hints. No invented ABI |
| Inspect tx | Inspect a tx hash | Status, value, logs, explorer |
| Thin book | Swap 0.01 0G to WBTC | Quote; refuse if amountOut is zero/thin |
| Analyze | Analyze this wallet | RPC inspect, then optional paid TeeML job with that evidence |
| Bridge | How do I bridge to 0G? | Official venues + live LI.FI where supported |
| Bridge quote | Bridge 1 USDC from Base to 0G | Live LI.FI 8453 → 16661; user wallet signs |
| Bridge out | Bridge 0.3 0G to USDC on Base | Live LI.FI 16661 → 8453; Safe cannot sign source |
| Cheap | Run the cheapest verified model | Catalog `qwen3.8-flash` (proven), lock `0.001 0G` |
| Research | Research 0G Storage proofs | Cheap TeeML job + Storage root |
| Denied | Send 5 0G to a random address | Hard DENY. Funds moved **0 0G** |
| Why | Show me why that was blocked | Last policy block, before funds moved |
| Verify | Verify the last result | Proof URL + registry |
| Cost | Show what the last job cost | Quote breakdown in native 0G |
| Safe | Help me fund Beacon Safe and set spend policy | Deep-link to `/flow/security` |
| Pause | Pause my Safe | Owner-signed `setPaused` on `/flow/security` |
| History | What did I do last week? | Evidence memory: History + Storage roots + explorer txs. Empty evidence → no invented log |
| Wallet errors | User rejected / wrong chain | Mapped failures (4001, 4902). Not faked success |

History persists per wallet. Spend tools show **four ledgers** (escrow, Safe window, Zia slice, gas) for 1d / 7d / 30d — never summed. Live `windowSpent` is Today only.

## Jobs

[/flow/desk](https://beacon-0g.vercel.app/flow/desk) quotes from the live Router catalog, then runs the same lock → TeeML → Compute → Storage → settle path.

| Service | Task | Model (proven / selected) |
|---|---|---|
| Image | image | `z-image-turbo` |
| Research | cheap chat | `qwen3.8-flash` |
| Coding | cheap chat | catalog cheap TeeTLS/TeeML |
| Documents | cheap chat | catalog cheap TeeTLS/TeeML |
| Analysis | inspect + cheap chat | RPC first, then TeeML brief |

Every closed job gets **View result**, **View proof**, Storage root, lock/release/refund txs, action hash, and ERC-8004 feedback after real settlement.

Proven Jobs/MCP examples:

- Research/infer [`d58275e0`](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f) · [`75dde1f5`](https://beacon-0g.vercel.app/verify/75dde1f5-4e34-4839-960c-2c7f382de640)
- Image [`6905f25c`](https://beacon-0g.vercel.app/verify/6905f25c-e961-4c86-9df5-efdd31fb8cbc)
- Analysis [`5d71852d`](https://beacon-0g.vercel.app/verify/5d71852d-b38f-42cd-8f53-f0fc3075c9c7)

## Safe

[/flow/security](https://beacon-0g.vercel.app/flow/security)

- **Create** — factory deploys `BeaconNativeVault`, seeds allowlists (escrow `lockNative`, W0G wrap/unwrap/approve, Zia `exactInputSingle`).
- **Deposit** — payable native 0G. Anyone may deposit; owner withdraws.
- **Unlock session** — EIP-191 challenge/verify (`/v1/auth/safe-session/*`). Browser Bearer. Not a chain tx.
- **Policy** — `maxSpendPerTx`, rolling window budget + seconds, session expiry. Executor cannot set policy.
- **Pause** — owner `setPaused`. Executor cannot pause. MCP `pause_safe` tells you to open this page.
- **Wealth** — native 0G + W0G. Wrap is not spend. A Zia swap that leaves W0G is spend.

Demo Safe: [`0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30`](https://chainscan.0g.ai/address/0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30).

## Agents (MCP)

[/flow/mcp](https://beacon-0g.vercel.app/flow/mcp) · endpoint `https://beacon-0g-api.onrender.com/mcp`

1. Connect wallet (owner of the Safe).
2. Unlock the same agent session used on Safe.
3. **Connect Agent** — pick Cursor / Claude / generic, scopes, caps (max 5 / 20 0G).
4. Paste `mcp.json` or click **Authenticate** (OAuth PKCE).
5. External agent calls `get_safe`, `get_policy`, `infer`, `swap`, `preflight_tx`, `bridge`, `verify_job`, …
6. **Revoke** burns the grant. Tokens stop.

**The agent never receives the private key.**

## What Beacon Is

Beacon is a production desk on **0G Aristotle** (chain id **16661**). The unit of account is **native 0G**. Router catalog USD figures are display hints from `pricing`; they are not an FX oracle and they are not what the vault locks.

A user (or an external MCP agent) states an intent. Beacon:

1. Quotes the job from the live 0G Compute Router catalog in **neurons** (`1e18` neuron = `1` 0G).
2. Runs deterministic preflight (target, selector, value, destination, deadline, minOut, nonce) plus `eth_call` simulation from the Safe executor.
3. Asks TeeML for ALLOW/DENY, then recovers the provider EIP-191 signature against the on-chain TEE signer.
4. Locks native 0G in `BeaconJobEscrow` from the user's `BeaconNativeVault` (Beacon Safe).
5. Calls 0G Compute (`chat/completions` or `z-image-turbo`).
6. Encrypts the evidence packet (AES-256-CTR) and uploads it through the official 0G Storage turbo indexer.
7. Optionally executes a Zia wrap → approve → `exactInputSingle`, or returns a live LI.FI source-chain transaction for the user wallet to sign.
8. Releases or refunds the escrow, records `BeaconReceiptRegistry`, binds an action hash, and anchors a Merkle root on `BeaconEvidenceAnchor`.
9. Posts official ERC-8004 `giveFeedback` from a dedicated client that is **not** the agent owner.
10. Exposes the whole trail on `/verify/:jobId`, including a browser `eth_call` of the receipt registry at `https://evmrpc.0g.ai`.

The external agent never receives a private key. Spend is bounded by on-chain Safe policy, MCP grant caps, and fail-closed TeeML.

## Why Beacon Exists

Giving an AI agent a hot wallet is an unbounded grant. The model can be wrong, the prompt can be adversarial, and “just this once” is still a signature.

Beacon separates **capability** from **authority**:

- The model proposes.
- Policy enumerates what may be spent, to which targets, with which selectors, inside which window.
- TeeML attests the intent inside a TEE.
- The Beacon Safe executor is the only key that can move vault 0G, and only inside those rules.
- Escrow holds the job budget until Compute and Storage complete.
- Proof is public: explorer transactions, Storage roots, registry rows, action hashes, ERC-8004 feedback.

That is the product. Not a chatbot with a block explorer link glued on afterwards.

## Why 0G Matters

Beacon is built around 0G primitives. Remove any one of them and the desk stops being Beacon.

### 0G Chain / Aristotle

Aristotle is the settlement and policy plane. Chain id **16661**. Native gas token **0G**. RPC [`https://evmrpc.0g.ai`](https://evmrpc.0g.ai). Explorer [`https://chainscan.0g.ai`](https://chainscan.0g.ai). Network details: [0G Mainnet Overview](https://docs.0g.ai/developer-hub/mainnet/mainnet-overview).

Without Aristotle there is no Beacon Safe, no escrow, no receipt registry, no Merkle anchor, and no ERC-8004 reputation. Beacon would be an off-chain log.

### Native 0G as the economic unit

Every quote, lock, cap, grant, and spend ledger is native 0G. Compute Router `pricing` is neurons. `1e18` neuron = `1` 0G. USD is a catalog hint.

Without native 0G pricing, job locks would be an invented FX rate. The vault would not know what it is authorizing.

### 0G Compute

Jobs call the Compute Router at [`https://router-api.0g.ai`](https://router-api.0g.ai) (`GET /v1/models`, `POST /v1/chat/completions`, image via `z-image-turbo`). Catalog selection is live. Docs: [0G Compute Overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview).

Without Compute, Beacon cannot run policy review or inference on 0G GPUs. There is no cloud-LLM fallback in this repository; CI `guard-fallbacks` fails the build if banned rails appear.

### Private / TeeML

Policy review uses a TeeML tools+JSON model (`glm-5.3` when present in the catalog). Independent verification is on-chain `getService` plus provider `/v1/proxy/signature/{chatID}` recovered as EIP-191 against the TEE signer. Missing `ZG-Res-Key` / `chatID` is DENY (`TEE_FAIL_CLOSED=true`).

Router `x_0g_trace` / `tee_verified` is persisted on `/verify` as **what the Router reported**, with a locally computed `claimHash`. That is not a substitute for EIP-191 recover.

Without TeeML, intent review would be an ordinary model call with no signer to recover.

### 0G Storage

Evidence is encrypted, then uploaded with `@0gfoundation/0g-storage-ts-sdk` against the turbo indexer [`https://indexer-storage-turbo.0g.ai`](https://indexer-storage-turbo.0g.ai). The Flow contract is [`0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526`](https://chainscan.0g.ai/address/0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526). Roots are inspectable on [StorageScan](https://storagescan.0g.ai). Docs: [Storage SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk), [Storage CLI](https://docs.0g.ai/developer-hub/building-on-0g/storage/storage-cli).

If the official SDK cannot import, upload throws. There is no in-memory “success”.

Without Storage, receipts would be API JSON that anyone could edit.

### Verifiable evidence and on-chain receipts

`BeaconReceiptRegistry` stores `storageRoot`, `teeSigner`, `chatIdHash`, `quoteHash`, and `allowed`. `/verify` re-reads that row from the browser via `eth_call`. Action hashes bind request, policy, TEE, storage, lock, settle, and receipt. `BeaconEvidenceAnchor` commits a Merkle root of those hashes.

Without the chain + Storage pair, “proof” would be a screenshot.

### ERC-8004 and agent reputation

Identity registry [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://chainscan.0g.ai/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432). Reputation proxy [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://chainscan.0g.ai/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63), EIP-1967 implementation `0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34`. Agent id **3531902**. Agent card: [https://beacon-0g.vercel.app/.well-known/agent-card.json](https://beacon-0g.vercel.app/.well-known/agent-card.json). Spec: [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004).

`register()` is on-chain. `giveFeedback` uses the official 8-argument selector `0x3c036a7e` on the implementation bytecode. The agent owner cannot self-feedback. Feedback is posted only after a real release or refund.

Without ERC-8004, closed jobs would not accumulate a standard reputation trail.

### Scalable proof

One `anchor(root, leafCount)` transaction covers many action hashes. Individual jobs remain independently verifiable with an off-chain Merkle proof on `/verify`.

Without Aristotle cheap settlement, every job would need its own expensive attestation chain. 0G is the reason the proof plane scales.

## Product story

```
User / External Agent
  → Beacon Flow / MCP
  → Policy + MCP grant
  → Deterministic preflight + eth_call
  → TeeML + EIP-191
  → Beacon Safe
  → BeaconJobEscrow lockNative
  → 0G Compute Router
  → 0G Storage turbo
  → Zia / LI.FI / inspect
  → Release or Refund
  → ReceiptRegistry
  → Action hash + EvidenceAnchor
  → /verify/:jobId
  → ERC-8004 giveFeedback
```

An external agent with a Bearer grant can quote, inspect, infer, swap, and request a bridge. It cannot export `SETTLER_PRIVATE_KEY` or the Safe owner key. If the grant is revoked, existing tokens stop. If the Safe is paused, the executor cannot spend. If preflight or TeeML DENY, escrow is refunded (or never locked). Funds moved on a denied unconstrained transfer is **0 0G**.

## Capabilities

### Understand

- **Wallet analysis** — live Aristotle `eth_getBalance`, bytecode size, selector hints. No invented ABI.
- **Contract analysis** — EIP-1967 implementation slot when present; code size; explorer link.
- **Transaction inspection** — status, value, logs, selector, from/to. Example inspect target used in Flow: [`0x5f056d0d5c51413450a639fb1e755354b43b13917c1470d4e56ac9fe3a0e9fc9`](https://chainscan.0g.ai/tx/0x5f056d0d5c51413450a639fb1e755354b43b13917c1470d4e56ac9fe3a0e9fc9).
- **Research** — cheapest verified TeeTLS/TeeML chat model from the live catalog (proven: `qwen3.8-flash`), locked, stored, receipted.

### Create

- **Image** — `z-image-turbo` (TeeML) via 0G Compute. Proven job [`6905f25c-e961-4c86-9df5-efdd31fb8cbc`](https://beacon-0g.vercel.app/verify/6905f25c-e961-4c86-9df5-efdd31fb8cbc).
- **Research / documents / coding inference** — catalog `cheap` task through Router `chat/completions`. Proven MCP infer [`d58275e0-7c92-4b26-a040-cba09c7cfe4f`](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f) (`qwen3.8-flash`, lock `0.001 0G`).

### Move

- **Zia swap** — live factory `getPool` + QuoterV2. Native 0G wraps to W0G, then `exactInputSingle` on the Zia SwapRouter. Zero or thin `amountOut` is refused. There is no second DEX. Token→0G quotes are live; Safe **execution** is refused because `wealth()` is native 0G + W0G only. Docs: [Zia](https://docs.zia.finance/).
- **Bridge** — live LI.FI quotes (`https://li.quest/v1`) in the requested direction. Proven executable quotes: native **0G → USDC on Base** (16661 → 8453) and **USDC on Base or Ethereum → USDC.e on 0G**. Beacon Safe cannot sign a source-chain transaction. The user wallet signs; Beacon polls until LI.FI is DONE **with a destination tx for this same source hash**. Official 0G note on LI.FI: [How to Get 0G](https://docs.0g.ai/introduction/how-to-get-0g). LI.FI API: [docs.li.fi](https://docs.li.fi/api-reference/introduction).

### Protect

- Personal `BeaconNativeVault` (Safe) from `BeaconVaultFactory`.
- Owner-set `maxSpendPerTx`, rolling window budget, session expiry, pause.
- Allowlisted targets and selectors (escrow `lockNative`, W0G wrap/unwrap/approve, Zia `exactInputSingle`).
- Deterministic preflight + executor `eth_call`. Independent revert is DENY.
- TeeML fail-closed. Hard firewall DENY always wins over a model ALLOW.
- MCP grant caps (default **5 0G / tx**, **20 0G / day**, TTL **7 days**) stacked on Safe policy.
- `revoke_agent` immediately invalidates the Bearer grant.
- Pause is **owner-signed** `setPaused` on [`/flow/security`](https://beacon-0g.vercel.app/flow/security). The executor cannot pause. MCP `pause_safe` says so.

### Prove

- Public [`/verify/:jobId`](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f).
- 0G Storage root + StorageScan.
- Action hash (`keccak256(abi.encode)` of chainId, job, wallet, vault, brief, policy, quote, TEE, storage, lock, settle, receipt, nonce, deadline). Browser recomputes it.
- Merkle batch on `BeaconEvidenceAnchor`.
- Receipt registry `eth_call` from the browser.
- ERC-8004 `giveFeedback` with `feedbackURI` pointing at `/verify/:id`.

### External Agents

- MCP at [`https://beacon-0g-api.onrender.com/mcp`](https://beacon-0g-api.onrender.com/mcp).
- Connect UI: [`https://beacon-0g.vercel.app/flow/mcp`](https://beacon-0g.vercel.app/flow/mcp).
- **30 tools** (read + exec). Default connect scopes omit `exec:pause`.
- Bearer grants; Connect-Agent tokens last until grant expiry. OAuth PKCE for clients that Authenticate (`GET /.well-known/oauth-protected-resource`). Unauthenticated `GET /mcp` returns **401** + `WWW-Authenticate`.
- History, `verify_job`, `get_proof`, `revoke_agent`.
- The agent never receives a private key.

## Architecture diagrams

### 1. Overall architecture

```
Intent: User → Flow
        MCP client → MCP
Beacon: Flow / MCP → Policy → Preflight → TeeML → Beacon Safe → Job Escrow
0G:     Job Escrow → Compute → Storage
        Beacon Safe → Zia
        Beacon Safe → Aristotle
Proof:  Storage → Receipt → Action hash → ERC-8004
```

### 2. Job lifecycle

```
User or MCP
  → GET router-api.0g.ai/v1/models
  → neurons lock in native 0G
  → preflight plus EIP-191
  → ALLOW
  → Beacon Safe lockNative
  → 0G Compute (chat or z-image-turbo)
  → 0G Storage encrypted evidence
  → storageRoot on ReceiptRegistry
  → release or refund
  → /verify jobId
```

### 3. MCP

```
Claude / Cursor / MCP client
  → Bearer or OAuth PKCE
  → Beacon MCP
  → Scoped grant (TTL + caps you choose)
  → Policy plus preflight
  → Beacon Safe executor
  → 0G Compute / Storage / Zia
  → Aristotle transaction
  → verify_job plus History

The agent never receives the private key.
```

### 4. Swap

```
Intent 0G → USDC
  → Live Zia QuoterV2
  → Preflight plus policy
  → W0G.deposit
  → W0G.approve SwapRouter
  → exactInputSingle
  → Safe wealth (native + W0G)
  → History plus explorer
```

### 5. Bridge

```
Directional intent
  → GET li.quest/v1/quote
  → Unsigned tx for user wallet
  → Source chain signature
  → Destination 0G or Base
  → track_bridge DONE + dest tx + same source hash
```

Beacon Safe lives on Aristotle. It cannot sign Ethereum, Base, or any other source-chain bridge transaction.

### 6. Evidence / proof

```
Intent plus quote plus TEE
  → actionHash keccak256(abi.encode)
  → 0G Storage evidence packet
  → Merkle root → BeaconEvidenceAnchor.anchor
  → /verify
  → ReceiptRegistry eth_call
```

## Contracts + deployments

All Beacon-owned contracts below are on **0G Aristotle (16661)**. Addresses are pinned in `packages/shared/src/constants.ts` and `.env.example`.

| Name | Address | Purpose | Explorer | Proof tx |
|---|---|---|---|---|
| BeaconJobEscrow | `0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566` | Lock native 0G; owner releases to treasury or refunds payer | [address](https://chainscan.0g.ai/address/0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566) | [deploy](https://chainscan.0g.ai/tx/0x09ae204b7de2dbc7b6f6e8ede3cf15dde929b26d5bb19fdd6dd7b6b3b4f76361) |
| BeaconReceiptRegistry | `0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887` | On-chain job receipt (storage root, TEE signer, quote hash) | [address](https://chainscan.0g.ai/address/0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887) | [deploy](https://chainscan.0g.ai/tx/0xb7b11b8187c11274cb4b5fbb63c3eeeade5f5c753e7dab17ad195a66edffda10) · [setRecorder](https://chainscan.0g.ai/tx/0xddd8c51844fd13814036dfd0066b01c9f81957c494fd76f1a71bb2a76b11f92a) |
| BeaconVaultFactory | `0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1` | One `BeaconNativeVault` per owner; seeds allowlists | [address](https://chainscan.0g.ai/address/0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1) | [deploy](https://chainscan.0g.ai/tx/0x98cd458160352cd0a8395de0aa7addeaab90656967b74bc124ea3334082e0b34) |
| BeaconNativeVault (demo Safe) | `0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30` | Prepaid native 0G + W0G; executor spends inside policy | [address](https://chainscan.0g.ai/address/0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30) | [createSafe](https://chainscan.0g.ai/tx/0x546e797fd7e4dd529680501867321016ecd8ea2685409cd70b1a90b86cb50edf) · [deposit 0.05 0G](https://chainscan.0g.ai/tx/0x52ebe8921424e7f62bf762261af98955681d0f4b0791679a4a1a234ed482baae) |
| BeaconEvidenceAnchor | `0xB94934f848A13Ae5E7fC5B2a91E61EDFaEc4ca6B` | Merkle root of action hashes | [address](https://chainscan.0g.ai/address/0xB94934f848A13Ae5E7fC5B2a91E61EDFaEc4ca6B) | [deploy](https://chainscan.0g.ai/tx/0x32e8b6cf1c8e62dc2819f78887d9b51f9e5b3016e2ab32e00dc762e42895b424) · [smoke anchor](https://chainscan.0g.ai/tx/0xae0bb05a22e58accc22b8b8c0e3b5f96787f4413117372d251a94fef4b36da15) |

Solidity: `packages/contracts/src/` (`BeaconJobEscrow`, `BeaconReceiptRegistry`, `BeaconVaultFactory`, `BeaconNativeVault`, `BeaconEvidenceAnchor`).

### External integrations (pinned)

| Name | Address | Role |
|---|---|---|
| W0G | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) | Canonical wrapped native 0G |
| Zia factory | [`0x6F3945Ab27296D1D66D8EEb042ff1B4fb2E0CE70`](https://chainscan.0g.ai/address/0x6F3945Ab27296D1D66D8EEb042ff1B4fb2E0CE70) | Pool discovery |
| Zia SwapRouter | [`0x18cCa38E51c4C339A6BD6e174025f08360FEEf30`](https://chainscan.0g.ai/address/0x18cCa38E51c4C339A6BD6e174025f08360FEEf30) | `exactInputSingle` (`0x414bf389`) |
| Zia QuoterV2 | [`0x23b55293b7F06F6c332a0dDA3D88d8921218425B`](https://chainscan.0g.ai/address/0x23b55293b7F06F6c332a0dDA3D88d8921218425B) | `quoteExactInput` |
| USDC.e (CCIP) | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) | Bridged USDC on Aristotle |
| Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | LI.FI dest/source on Base (8453) |
| 0G Storage Flow | [`0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526`](https://chainscan.0g.ai/address/0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526) | Storage payment flow |
| 0G Compute Ledger | [`0x2dE54c845Cd948B72D2e32e39586fe89607074E3`](https://chainscan.0g.ai/address/0x2dE54c845Cd948B72D2e32e39586fe89607074E3) | Compute billing |
| 0G Inference | [`0x47340d900bdFec2BD393c626E12ea0656F938d84`](https://chainscan.0g.ai/address/0x47340d900bdFec2BD393c626E12ea0656F938d84) | Inference service registry |
| ERC-8004 Identity | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://chainscan.0g.ai/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | `register()`, agent 3531902 |
| ERC-8004 Reputation | [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://chainscan.0g.ai/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) | proxy; `giveFeedback` on implementation `0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34` |

Owner / demo wallet (public address): `0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf`.

# 0G Integration

## 0G Chain

**What it does.** Production EVM L1 (Aristotle, 16661) with native 0G gas, Chainscan, and contract settlement.

**How Beacon uses it.** Every Safe, escrow lock, release, refund, receipt, anchor, Zia hop, and ERC-8004 call is an Aristotle transaction. Inspect is live RPC only.

**Why it matters.** Policy is not a JSON file. Caps, pause, allowlists, and settlement are contract state.

**Proof.** `eth_chainId` = `0x4115` (16661). Escrow deploy [0x09ae204b…](https://chainscan.0g.ai/tx/0x09ae204b7de2dbc7b6f6e8ede3cf15dde929b26d5bb19fdd6dd7b6b3b4f76361).

## 0G Compute

**What it does.** Decentralized GPU marketplace. Router is a single `chat/completions` endpoint with catalog pricing in neurons. [Compute docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview).

**How Beacon uses it.** `GET https://router-api.0g.ai/v1/models` (32 models on the live API at documentation time). `selectModel` picks TeeML `glm-5.3` for policy, catalog cheap TeeTLS/TeeML for infer/research (`qwen3.8-flash` on proven jobs), `z-image-turbo` for image.

**Why it matters.** Job cost is 0G, not a card network. The same asset the Safe holds is the asset Compute bills.

**Proof.** Hosted cheap job [`75dde1f5-4e34-4839-960c-2c7f382de640`](https://beacon-0g.vercel.app/verify/75dde1f5-4e34-4839-960c-2c7f382de640) lock [0xc6f3506d…](https://chainscan.0g.ai/tx/0xc6f3506dfeaa9b0225cd016c861969d7d9e24437af1065ff57b097601cd07639) · MCP infer [`d58275e0`](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f) on `qwen3.8-flash`.

## TeeML

**What it does.** Inference inside a TEE. Provider signs the result. [0G Compute trust section](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview).

**How Beacon uses it.** Layer-2 policy: tools+JSON ALLOW/DENY. Independent path: on-chain `getService` → provider signature → EIP-191 recover. `processResponse` is recorded when the broker returns it. Missing attestation keys DENY.

**Why it matters.** The spend boundary is not “the model said OK”. It is a recovered signer that must match the TEE address.

**Proof.** Job `d58275e0` `eip191Ok: true`, recovered signer `0xA46EA4FC5889AD35A1487e1Ed04dCcfa872146B9` matched expected. Reproduce locally with `npx tsx scripts/smoke-tee.ts`.

## EIP-191

**What it does.** Standard personal-sign recover of the TEE response.

**How Beacon uses it.** `/verify` and the settler treat EIP-191 match as independent TEE proof. Router `x_0g_trace` is displayed separately and labeled as Router-reported.

**Why it matters.** Anyone can re-recover the signer. You do not have to trust Beacon’s API field.

**Proof.** Same job: `tee.eip191Ok` plus registry `teeSigner` on [receipt 0xc3b52e8a…](https://chainscan.0g.ai/tx/0xc3b52e8a5ec50bdb80c6a8f5afa57b3e51820e6e8a46cdd3279539ef86ecfaf6).

## 0G Storage

**What it does.** Content-addressed storage with Merkle roots and a Flow contract for payment. [SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk).

**How Beacon uses it.** Encrypt the job packet, upload via turbo indexer, persist `storageRoot` on the job and in the receipt registry.

**Why it matters.** The brief, quote, TEE verdict, and result hash live at a root a judge can open on StorageScan.

**Proof.** [StorageScan root `0x7dc9ebb0…`](https://storagescan.0g.ai/?root=0x7dc9ebb01e44992424e38976d18c813d7969f9f2cbe47cc619f03a5fafa35e72). Earlier Flow upload [0xec1753ac…](https://chainscan.0g.ai/tx/0xec1753ac878eb0155d3a7f18fcfe656424c90e174a81053ecfb311afcf5b4620) to Flow `0x62D4144d…`.

## 0G model catalog

**What it does.** Live list of providers, verifiability (`TeeML` / `TeeTLS`), modalities, and neuron prices.

**How Beacon uses it.** No hardcoded dollar quotes. `packages/quote` selects by task. API `GET /v1/models`.

**Why it matters.** A disappeared model cannot be silently replaced by a banned cloud vendor; `NO_FIT` throws.

**Proof.** Health + models on [https://beacon-0g-api.onrender.com/health](https://beacon-0g-api.onrender.com/health). Proven ids: `qwen3.8-flash`, `glm-5.3` (policy, TeeML/Private), `z-image-turbo`.

## Native 0G pricing

**What it does.** Router `pricing` in neurons; `NEURONS_PER_0G = 10n ** 18n`.

**How Beacon uses it.** Escrow `lockNative` uses the quoted lock (minimum `0.001` 0G). Platform fee `500` bps. Compute buffer `200` bps. Max impact `300` bps.

**Why it matters.** The Safe’s wealth function and the job budget speak the same unit.

**Proof.** `d58275e0` lock `0.001 0G` (`1000000000000000` wei) in the verify payload and [lock tx](https://chainscan.0g.ai/tx/0x80416c858f0a4102f41d66db6af6e0eefdcefafb9aaf3fd46122582206181dc9).

## Zia

**What it does.** 0G-native DEX. Factory / SwapRouter / QuoterV2. [Zia docs](https://docs.zia.finance/).

**How Beacon uses it.** Only Zia. Wrap native 0G → approve → `exactInputSingle`. Thin book refused.

**Why it matters.** Swap spend reduces Safe `wealth()` (native+W0G). Wrap alone does not.

**Proof.** MCP 0.01 0G → USDC fulfill [0x3fa8f6d2…](https://chainscan.0g.ai/tx/0x3fa8f6d2894fc4f505c52366a4de6bb429ccecc623336290dc297743b258e6d0) (to demo Safe). Earlier wrap [0xdbf703b8…](https://chainscan.0g.ai/tx/0xdbf703b8bac18dec2048d7110908550fe07b72ff45973ef1cdead24f4408f818) · approve [0xf16cc392…](https://chainscan.0g.ai/tx/0xf16cc39234ca018b5a07b4f52cde2279e4638175c604bbf02a5f818a2d20c1d8) · `exactInputSingle` [0x9d964d7b…](https://chainscan.0g.ai/tx/0x9d964d7bb6415b0da0e17b7fcb7d65027ed77268a3cbbf05c3e7e0ab0e6d2cda).

## ERC-8004

**What it does.** Standard agent identity + reputation. [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004).

**How Beacon uses it.** `register()` minted agent **3531902**. After each real release/refund, a non-owner client posts `giveFeedback`. Live `GET /v1/erc8004/status` → `giveFeedback: REAL`.

**Why it matters.** Reputation is an on-chain event, not a leaderboard screenshot.

**Proof.** Register [0x0031c2c3…](https://chainscan.0g.ai/tx/0x0031c2c3e2ff668c92df778c003f49793b06513bd1e24c4fb16192142f54b023). Feedback index 5 [0x5c120e0b…](https://chainscan.0g.ai/tx/0x5c120e0bb11b9c4815879a4d3e3688244bcbb9ae9267e3de8a8445c3bcf1ded4). Status: [https://beacon-0g-api.onrender.com/v1/erc8004/status](https://beacon-0g-api.onrender.com/v1/erc8004/status). Card: [agent-card.json](https://beacon-0g.vercel.app/.well-known/agent-card.json).

## EvidenceAnchor

**What it does.** `anchor(bytes32 root, uint32 leafCount)` once per root.

**How Beacon uses it.** Job action hashes are leaves. `/verify` shows the Merkle proof. Browser keccak of the action encoding must match.

**Why it matters.** Many jobs, one cheap Aristotle tx, still independently checkable.

**Proof.** Batch for `d58275e0` (1-leaf root = action hash `0x39c693fc…`) [0x02cfd117…](https://chainscan.0g.ai/tx/0x02cfd117286598f9bd6b61d0f11d0ba1920257bac4ea09a3f56a8d48a7f89be2).

## MCP

**What it does.** Remote MCP (`2025-03-26`) so Cursor / Claude / generic clients execute under a grant.

**How Beacon uses it.** Wallet signature mints the grant in Redis. Every write re-checks scope, TTL, cap, Safe policy, preflight. Tools return explorer links and proof URLs.

**Why it matters.** This is how an external agent uses 0G without key export.

**Proof.** MCP infer job `d58275e0` (lock from Safe `0x6A3388…`). OAuth resource: [https://beacon-0g-api.onrender.com/.well-known/oauth-protected-resource](https://beacon-0g-api.onrender.com/.well-known/oauth-protected-resource).

## Bridge

**What it does.** LI.FI aggregation for 0G (`zerog` / 16661) as documented by 0G.

**How Beacon uses it.** Directional parser: native 0G / W0G as input always sources from 16661. Live quote only. Execution mode `WALLET_EXECUTABLE`. `track_bridge` requires DONE + destination tx + **same source hash**.

**Why it matters.** Cross-chain value does not require giving the agent a key on Ethereum or Base.

**Proof.** Live quote path in `apps/api/src/lifiBridge.ts`. Jumper (LI.FI UI) for 0G→Base: [jumper.exchange from 16661 to 8453](https://jumper.exchange/?fromChain=16661&toChain=8453).

## Models

Selection is live from `GET https://router-api.0g.ai/v1/models` via `packages/quote/src/routeModel.ts`. Proven production ids:

| Model | Purpose | Route | Pricing | Where used |
|---|---|---|---|---|
| `glm-5.3` | Layer-2 policy ALLOW/DENY (tools+JSON) | TeeML / Private | catalog neurons | Policy review before spend |
| `qwen3.8-flash` | Cheap infer / research / analysis | TeeTLS (catalog) | catalog neurons; hosted lock `0.001 0G` | Flow cheaper jobs, MCP `infer` / `research`, job `d58275e0` / `75dde1f5` |
| `z-image-turbo` | Text-to-image | TeeML | catalog neurons; example lock `0.047771 0G` | MCP `generate_image`, job `6905f25c` |

USD in the quote payload is `pricing_usd` from the catalog, labeled as not an oracle.

## MCP

Production endpoint: **`https://beacon-0g-api.onrender.com/mcp`**

1. Owner opens [Connect Agents](https://beacon-0g.vercel.app/flow/mcp) and signs a grant (default 5 0G / tx, 20 0G / day, 7 days).
2. Client sends `Authorization: Bearer <access_token>` on every JSON-RPC POST.
3. Connect-Agent (Cursor `mcp.json`) tokens last until the grant expires. OAuth access tokens are ~1 hour and refresh at `POST /v1/mcp/oauth/token`.
4. Unauthenticated `GET /mcp` → 401 + `WWW-Authenticate`.
5. Writes still need grant scope, TTL, MCP cap, Safe policy, preflight, TeeML.
6. `revoke_agent` burns the grant. Spend tools report **four ledgers** (escrow, Safe `windowSpent`, Zia slice, wallet gas) for 1d / 7d / 30d — never summed. Live `windowSpent` is shown under Today only.

**The external agent never receives the private key.**

Safe configuration example (placeholder token only):

```json
{
  "mcpServers": {
    "beacon-0g": {
      "url": "https://beacon-0g-api.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer <access_token_from_flow_mcp>"
      }
    }
  }
}
```

Mint the real token at [`/flow/mcp`](https://beacon-0g.vercel.app/flow/mcp). Do not commit it.

Tools: `get_safe`, `get_balance`, `get_policy`, `get_spend`, `get_jobs`, `get_history`, `get_job`, `verify_job`, `get_proof`, `get_receipt`, `get_supported_actions`, `create_job`, `infer`, `generate_image`, `research`, `quote_swap`, `list_swap_assets`, `preflight_tx`, `swap`, `execute_swap`, `inspect`, `inspect_wallet`, `inspect_contract`, `inspect_transaction`, `bridge`, `quote_bridge`, `track_bridge`, `why_denied`, `revoke_agent`, `pause_safe`.

## Bridge

Beacon quotes **LI.FI in the direction the user asked**.

| Intent | Source | Dest | Result |
|---|---|---|---|
| Bridge native 0G to USDC on Base | 16661 | 8453 | Live Stargate quote, wallet-executable |
| Bridge USDC from Base to 0G | 8453 | 16661 | Live quote to USDC.e |
| Bridge USDC from Ethereum to 0G | 1 | 16661 | Live quote to USDC.e |
| Other chains (example: Solana) | — | — | `UNSUPPORTED_ROUTE` — no reverse retry |

Rules in force:

- Native 0G / W0G as the input asset always sources from Aristotle **16661**. “from Base” with a 0G amount is the destination, not a reverse quote.
- Beacon Safe **cannot** sign the source chain. Flow / MCP return an unsigned LI.FI `transactionRequest` for the **user wallet**.
- `track_bridge` is complete only if LI.FI status is DONE, a destination transaction exists, and that destination belongs to **this same source hash**.
- Acquire native 0G: [get.0g.ai](https://get.0g.ai/).

## Verified Mainnet Proofs

Every hash below returned `eth_getTransactionReceipt.status = 0x1` on `https://evmrpc.0g.ai` at documentation time.

### Full-stack proof example A — MCP infer (strongest)

Job [`d58275e0-7c92-4b26-a040-cba09c7cfe4f`](https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f)

Quote `qwen3.8-flash` → policy/TeeML (`eip191Ok`) → Compute → Storage → escrow lock → release → receipt → action hash → EvidenceAnchor → ERC-8004 feedback index 5.

| Step | Network | Transaction | What it proves |
|---|---|---|---|
| Escrow lock (via Safe) | Aristotle | [0x80416c85…](https://chainscan.0g.ai/tx/0x80416c858f0a4102f41d66db6af6e0eefdcefafb9aaf3fd46122582206181dc9) | `lockNative` 0.001 0G from Safe `0x6A3388…` |
| Release | Aristotle | [0xe489ebb1…](https://chainscan.0g.ai/tx/0xe489ebb17830ce317e59dbeb126f4d1076557e3b7993b7f4f7d23250fbe5e70a) | Escrow paid treasury; job SUCCESS |
| Receipt | Aristotle | [0xc3b52e8a…](https://chainscan.0g.ai/tx/0xc3b52e8a5ec50bdb80c6a8f5afa57b3e51820e6e8a46cdd3279539ef86ecfaf6) | Registry row; `allowed=true` |
| ERC-8004 giveFeedback | Aristotle | [0x5c120e0b…](https://chainscan.0g.ai/tx/0x5c120e0bb11b9c4815879a4d3e3688244bcbb9ae9267e3de8a8445c3bcf1ded4) | Reputation event index 5, non-owner client |
| EvidenceAnchor | Aristotle | [0x02cfd117…](https://chainscan.0g.ai/tx/0x02cfd117286598f9bd6b61d0f11d0ba1920257bac4ea09a3f56a8d48a7f89be2) | Merkle root = action hash `0x39c693fc7ecb5e6e355fbf2930ffcf875e6f05b894bdf789f64193406ebbb7c2` |
| Storage | 0G Storage | [root 0x7dc9ebb0…](https://storagescan.0g.ai/?root=0x7dc9ebb01e44992424e38976d18c813d7969f9f2cbe47cc619f03a5fafa35e72) | Encrypted evidence packet |

API: [https://beacon-0g-api.onrender.com/v1/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f](https://beacon-0g-api.onrender.com/v1/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f)

### Full-stack proof example B — infer + Router trace

Job [`47c5e72b-81d8-4c84-980e-82fd78c36603`](https://beacon-0g.vercel.app/verify/47c5e72b-81d8-4c84-980e-82fd78c36603)

| Step | Transaction | What it proves |
|---|---|---|
| Lock | [0x04072ec9…](https://chainscan.0g.ai/tx/0x04072ec961e96856c9f0e3bf7cee04f5e9a33232a0d8f58034c9fb9e5b0dea6c) | Safe-origin lock |
| Release | [0x4e83e10e…](https://chainscan.0g.ai/tx/0x4e83e10e6769454c88a3e554e8534b37b0d794de2da89ce24ac74237fb861e96) | Settlement |
| Receipt | [0xf6d8d054…](https://chainscan.0g.ai/tx/0xf6d8d0540f96da6faf8eb37d2379a2a74c8074eac36e529ac503285ccd3d12a4) | Registry |
| Feedback | [0xc99b1008…](https://chainscan.0g.ai/tx/0xc99b100858ecb5666fe05f640b5f62552fe9e5b9f9c20e7cb8687d64ae6555a7) | ERC-8004 index 4 |
| Storage | [root 0xbff28bfc…](https://storagescan.0g.ai/?root=0xbff28bfc356eb5bdee1a607cf4d0495e85e974bf5bdc2c3c5d551a0bfe56caff) | Evidence |

`/verify` also shows Router `x_0g_trace` (request id / provider / `tee_verified`) plus a local keccak fingerprint — Router-reported, beside EIP-191.

### Safe, escrow, refund, swap, identity

| Description | Transaction | What it proves |
|---|---|---|
| createSafe | [0x546e797f…](https://chainscan.0g.ai/tx/0x546e797fd7e4dd529680501867321016ecd8ea2685409cd70b1a90b86cb50edf) | Factory deployed demo Safe |
| Deposit 0.05 0G | [0x52ebe892…](https://chainscan.0g.ai/tx/0x52ebe8921424e7f62bf762261af98955681d0f4b0791679a4a1a234ed482baae) | Native funding |
| Controlled refund | [0xc7147df0…](https://chainscan.0g.ai/tx/0xc7147df0bf133bfa29910dca57d3969d74eddd43d943217173b6462400082a4f) | TeeML DENY → refund, not release. Job [`ab484794`](https://beacon-0g.vercel.app/verify/ab484794-b2f3-46a7-a6b3-83daca2abbc4) |
| Refund lock | [0xf37fd3d1…](https://chainscan.0g.ai/tx/0xf37fd3d16f111cc9f4a12e27e0c70b1122f2a39fdf65b687f31f97716cae15d8) | 0.001 0G locked before DENY |
| MCP Zia swap 0.01 0G→USDC | [0x3fa8f6d2…](https://chainscan.0g.ai/tx/0x3fa8f6d2894fc4f505c52366a4de6bb429ccecc623336290dc297743b258e6d0) | Real SwapRouter fill from Safe |
| ERC-8004 register | [0x0031c2c3…](https://chainscan.0g.ai/tx/0x0031c2c3e2ff668c92df778c003f49793b06513bd1e24c4fb16192142f54b023) | Agent 3531902 |
| First giveFeedback | [0x54683f6c…](https://chainscan.0g.ai/tx/0x54683f6c3774aed61c6233bc90f7fbb1841884aad2ecee4b89cf12f7a12d4c90) | Analysis job [`5d71852d`](https://beacon-0g.vercel.app/verify/5d71852d-b38f-42cd-8f53-f0fc3075c9c7) |
| Image lock / release | [0xbc88421b…](https://chainscan.0g.ai/tx/0xbc88421b735c6627ceb2058cd4ebadf7c25ec8fb8f259396b1bda701ad66f767) · [0x683bf19a…](https://chainscan.0g.ai/tx/0x683bf19a48428e1207cae858947600bdded5e20161bcab2bdf3b94d7c8e7c4a7) | `z-image-turbo` job [`6905f25c`](https://beacon-0g.vercel.app/verify/6905f25c-e961-4c86-9df5-efdd31fb8cbc) |

## Testing

Counts from this tree, not estimates:

| Suite | Command | Result | What it validates |
|---|---|---|---|
| Guard | `npm run guard` | **225 files** scanned | Banned fallback rails cannot land in `apps/`, `packages/`, `scripts/`, CI, or this README |
| Typecheck | `npm run typecheck` | `tsc -b` | Workspace TypeScript |
| Unit / integration (Vitest) | `npm test` | **225 tests**, **49 files** | Quote routing, MCP grants/OAuth, preflight, guards, risk, action proof, Merkle, Zia intent, LI.FI direction, inspect, ERC-8004 encoding, Flow classify, spend ledgers, Storage encrypt, Compute image helpers, receipt packets, web verify hashing |
| Foundry | `npm run test:contracts` or `forge test --root packages/contracts` | **25 tests**, 5 suites | Escrow lock/release/refund, vault wealth/wrap/spend/pause/nonce/window, factory allowlists, registry once-write, EvidenceAnchor |
| CI | `.github/workflows/ci.yml` | GitHub Actions on `main` | `npm ci --legacy-peer-deps` → guard → tsc → vitest → forge |

There is no separate Playwright suite in this repository. Live Aristotle checks are the smoke scripts:

```bash
npm run smoke:mainnet          # chain id, pins, explorer
npm run smoke:storage-swap     # Storage upload + Zia quote path
npm run smoke:erc8004          # identity / giveFeedback probe
npx tsx scripts/smoke-tee.ts   # EIP-191 recover vs TEE signer
npm run smoke:image            # z-image-turbo
npm run smoke:job-loop         # hosted lock → compute → storage → release
npm run validate:production    # production URL / pin checks
npm run smoke:production       # live API health + critical routes
```

Smokes need funded keys in a local `.env` (never commit it).

## Local reproduction

Requirements: Node **≥ 20**, Foundry (`forge`), git.

```bash
git clone https://github.com/goat-dev8/beacon-0g.git
cd beacon-0g
cp .env.example .env
# fill secrets locally: COMPUTE_API_KEY, SETTLER_PRIVATE_KEY, DATABASE_URL, Redis
npm install --legacy-peer-deps
npm run guard
npm run typecheck
npm test
forge test --root packages/contracts
```

`legacy-peer-deps` is required because `@0gfoundation/0g-storage-ts-sdk@1.2.11` pins a specific ethers 6.13.x peer while Beacon uses ethers 6.17.

### Environment

Copy names from [`.env.example`](.env.example). Do not commit `.env`.

| Area | Variables | Notes |
|---|---|---|
| Chain | `CHAIN_ID=16661`, `ZEROG_RPC_URL`, explorer, router, indexer | Must be Aristotle |
| TEE | `TEE_FAIL_CLOSED=true` | Missing attestation DENY |
| Contracts | `BEACON_JOB_ESCROW`, `BEACON_RECEIPT_REGISTRY`, `BEACON_VAULT_FACTORY`, `BEACON_EVIDENCE_ANCHOR` | Production pins listed above |
| Compute | `COMPUTE_API_KEY` | Router key from 0G; not in git |
| Settler | `SETTLER_PRIVATE_KEY` | Escrow owner / recorder; executor, not the user’s seed |
| Evidence | `ZEROG_EVIDENCE_KEY` | AES key for Storage packets |
| API / web | `API_PORT`, `VITE_API_URL`, `VITE_CHAIN_ID` | Local web → local or hosted API |
| History / MCP | `DATABASE_URL`, `REDIS_URL` or Upstash REST | Postgres job/history; Redis grants |
| Flags | `ENABLE_SWAP=true` | Swap on; keep `CHAIN_ID=16661` |

Run:

```bash
npm run api          # apps/api :3001
npm run settler      # settlement worker
npm run web          # Vite :5173
```

Frontend production API base is `https://beacon-0g-api.onrender.com` (`apps/web/.env.production`).

A judge can clone, install, and run `npm test` plus `forge test --root packages/contracts` with no secrets. Smokes and a local API need keys and Postgres/Redis as in `.env.example`.

## Security

- **Bounded spend.** Safe `maxSpendPerTx` + rolling window + MCP 5/20 caps. Four spend ledgers are never added into one fake number.
- **Safe.** Only the allowlisted executor calls `execute`. Owner withdraws, sets policy, pauses. TEE is not a Solidity role.
- **Policy.** Targets and selectors allowlisted at Safe creation (escrow, W0G, Zia). Unknown selector/target is BLOCK.
- **Deterministic preflight.** Hard DENY on target/selector/value/destination/deadline/minOut/nonce mismatch. Independent `eth_call` revert is DENY.
- **TEE + EIP-191.** Fail-closed. Semantic ALLOW cannot override a hard firewall DENY (`ANY-REJECT` / unanimous / majority modes exist; hard DENY always wins).
- **Escrow.** Job budget sits in `BeaconJobEscrow`, not in the model. Release and refund are owner-only; a stranger cannot settle.
- **Scoped MCP.** Bearer grant + TTL + scopes. `SCOPE_DENIED`, `MCP_TX_LIMIT`, `SAFE_PAUSED` stop the client.
- **Revoke.** `revoke_agent` invalidates tokens immediately.
- **Evidence.** Action hash, Storage root, registry, Merkle anchor. `/verify` is a forensic page, not a marketing card.
- **Receipts.** Browser `eth_call` of the registry — API JSON alone is not a pass.

An external AI agent cannot drain the Safe: it has no owner key, no executor key, no unrestricted target list, no way around per-tx and window caps, and no way to skip TeeML + preflight. A drain-shaped brief is DENY and refunds (proven: [`ab484794`](https://beacon-0g.vercel.app/verify/ab484794-b2f3-46a7-a6b3-83daca2abbc4)). Unconstrained “send 5 0G to a random address” is blocked with **funds moved 0 0G**.

## Packages

| Package | Role |
|---|---|
| `@beacon/shared` | Env Zod schema, job states, neuron math, Aristotle pins |
| `@beacon/quote` | Live catalog, model select, native 0G quotes |
| `@beacon/compute` | Router `chat/completions` + image |
| `@beacon/tee` | TeeML review + EIP-191 recover |
| `@beacon/storage` | Encrypt + official Storage SDK upload |
| `@beacon/swap` | Zia quote + `exactInputSingle` |
| `@beacon/receipts` | Off-chain packet + Merkle |
| `@beacon/mcp` | Grants, scopes, OAuth, 30 tools |
| `@beacon/execution` | Preflight, guards, risk, action hash, phase machine |

Apps: `apps/api` (Render), `apps/web` (Vercel), `services/settler`.

## Hosted surfaces

| Surface | URL |
|---|---|
| Web | https://beacon-0g.vercel.app |
| Flow | https://beacon-0g.vercel.app/flow |
| Connect Agents | https://beacon-0g.vercel.app/flow/mcp |
| Safe | https://beacon-0g.vercel.app/flow/security |
| API health | https://beacon-0g-api.onrender.com/health |
| MCP | https://beacon-0g-api.onrender.com/mcp |
| Agent card | https://beacon-0g.vercel.app/.well-known/agent-card.json |
| Strongest verify | https://beacon-0g.vercel.app/verify/d58275e0-7c92-4b26-a040-cba09c7cfe4f |
| GitHub | https://github.com/goat-dev8/beacon-0g |
| CI | https://github.com/goat-dev8/beacon-0g/actions/workflows/ci.yml |

Native 0G: [get.0g.ai](https://get.0g.ai/). Network: [Mainnet overview](https://docs.0g.ai/developer-hub/mainnet/mainnet-overview).

---

Beacon is not a chatbot.

It is an AI execution layer on 0G:

**AI capability → bounded authority → policy → TEE → Safe → 0G Compute → 0G Storage → real on-chain execution → cryptographic evidence → proof → ERC-8004 reputation.**
