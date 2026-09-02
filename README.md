# Beacon 0G

Beacon is a spend-bounded agent desk on **0G Aristotle** (chain id **16661**). The unit of account is **native 0G**. USD figures from the Compute Router catalog are display hints only — they are not an FX oracle and they are not what the vault locks.

## What this product does

1. User deposits native 0G into a personal `BeaconNativeVault`.
2. A job is quoted from `GET https://router-api.0g.ai/v1/models`. Catalog `pricing` is **neurons** (`1e18` neuron = `1` 0G).
3. On-chain policy (caps, window, pause, allowlisted targets/selectors) is the spend boundary. TeeML may recommend ALLOW/DENY; missing `ZG-Res-Key` / `chatID` is **DENY**.
4. Compute is 0G Router / Ledger. Storage evidence is encrypted (AES-256-CTR) then uploaded to 0G Storage (turbo indexer). Failures throw — there is no in-memory “success”.
5. Optional Zia swap: live factory pools from the [Zia mainnet token list](https://docs.zia.finance/0g-mainnet/mainnet-tokens). Native 0G wraps to W0G, then `exactInputSingle`. Token→0G quotes are live; Safe **execution** is refused because `wealth()` is native+W0G only. Zero or thin `amountOut` is refused. There is no second DEX.
6. Public `/verify/:jobId` is a forensic receipt. The page also `eth_call`s the receipt registry from the browser (`evmrpc.0g.ai`). API fields alone are not a pass. Jobs results include a **View proof** button.
7. Address/tx inspect is live Aristotle RPC only (inline in Flow). Paid TeeML explanation is a separate quoted job. Beacon does not invent ABIs. Bridges are catalogued from Zia docs / Hub / get.0g.ai and are **not** executable from the Beacon Safe.
8. MCP: connect at `/flow/mcp`. One wallet signature mints a scoped grant (default 5 0G / tx, 20 0G / day). `POST /mcp` accepts `Authorization: Bearer`. Clients that speak OAuth can **Authenticate** via PKCE (`GET /.well-known/oauth-protected-resource`). Unauthenticated `GET /mcp` returns 401 + `WWW-Authenticate` — it is not an open tool stream. Every write still passes grant scope, TTL, cap, Safe policy, and deterministic preflight. Spend tools report four ledgers (escrow, Safe window, Zia slice, gas) for 1d / 7d / 30d — never added together; on-chain `windowSpent` is the live rolling window and is shown under Today only. The agent never receives a private key. ERC-8004 `register()` is live (agent 3531902). `giveFeedback` uses the official 8-argument ABI on the Reputation **implementation** (the 130-byte address is a proxy). Feedback is posted only after a real job release or refund, from a client that is **not** the agent owner.

x402 and video generation are **off** by default (`ENABLE_X402=false`, `ENABLE_VIDEO=false`). This repo does not call cloud LLM fallbacks.

## Network (public)

| | |
|---|---|
| RPC | https://evmrpc.0g.ai |
| Explorer | https://chainscan.0g.ai |
| Storage scan | https://storagescan.0g.ai |
| Router | https://router-api.0g.ai |
| Indexer | https://indexer-storage-turbo.0g.ai |

Pinned contracts live in `packages/shared/src/constants.ts` (W0G, Zia, Flow, Ledger, Inference, ERC-8004).

## Packages

| Package | Role |
|---|---|
| `@beacon/shared` | Env Zod schema, job states, ids, `assertZeroGRequired` |
| `@beacon/quote` | Live catalog, model select, 0G neuron quotes |
| `@beacon/compute` | Ledger top-up + Router `chat/completions` |
| `@beacon/tee` | TeeML intent review + EIP-191 recover |
| `@beacon/storage` | Encrypt + Storage upload (loud failure) |
| `@beacon/swap` | Zia `quoteExactInput` / `exactInputSingle` |
| `@beacon/receipts` | Off-chain packet: `amount0g`, `storageRoot`, `teeSigner`, `quoteHash` |
| `@beacon/mcp` | Scoped MCP grants (`amount0g`) |
| `@beacon/execution` | Execution phase machine |

## Run

```bash
cp .env.example .env   # fill secrets locally; never commit them
npm install --legacy-peer-deps
npm test
npm run typecheck
forge test --root packages/contracts
```

`legacy-peer-deps` is required because `@0gfoundation/0g-storage-ts-sdk@1.2.11` pins a specific ethers 6.13.x peer while Beacon uses ethers 6.17.

Set `TEE_FAIL_CLOSED=true`. `CHAIN_ID` must be `16661`. Do not point jobs at simulated compute.

## Hosted

- Web: https://beacon-0g.vercel.app
- API: https://beacon-0g-api.onrender.com

## Honesty

- Vault wealth is native 0G + W0G. Bridged USDC out of a Zia swap is **not** vault wealth.
- Router `verify_tee` / `x_0g_trace` is not an independent proof. Independent check is EIP-191 recover against the TEE signer (and SDK `processResponse` when the broker is configured).
- Hub swap UI “Powered By” a different factory is not Zia. Beacon pins Zia factory `0x6F3945Ab27296D1D66D8EEb042ff1B4fb2E0CE70` and SwapRouter `0x18cCa38E51c4C339A6BD6e174025f08360FEEf30` ([Zia contracts](https://docs.zia.finance/security/contracts)).
- Get native 0G at [get.0g.ai](https://get.0g.ai/). Hub at [hub.0g.ai/swap](https://hub.0g.ai/swap?network=mainnet) is a different venue; Beacon does not call it.
- MetaMask may warn on `*.vercel.app` as a new domain. Beacon never asks for unlimited ERC-20 approvals. Deposit is payable native 0G to your Safe. Do not click through a warning you do not understand.
- Wallet txs set EIP-1559 fees from live `eth_gasPrice` / `eth_maxPriorityFeePerGas`, never below the 2 gwei floor Aristotle has rejected.
