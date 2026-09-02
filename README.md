# Beacon 0G

Beacon is a spend-bounded agent desk on **0G Aristotle** (chain id **16661**). The unit of account is **native 0G**. USD figures from the Compute Router catalog are display hints only — they are not an FX oracle and they are not what the vault locks.

## What this product does

1. User deposits native 0G into a personal `BeaconNativeVault`.
2. A job is quoted from `GET https://router-api.0g.ai/v1/models`. Catalog `pricing` is **neurons** (`1e18` neuron = `1` 0G).
3. On-chain policy (caps, window, pause, allowlisted targets/selectors) is the spend boundary. TeeML may recommend ALLOW/DENY; missing `ZG-Res-Key` / `chatID` is **DENY**.
4. Compute is 0G Router / Ledger. Storage evidence is encrypted (AES-256-CTR) then uploaded to 0G Storage (turbo indexer). Failures throw — there is no in-memory “success”.
5. Optional Zia swap: W0G → Bridged USDC at fee 3000 via Zia QuoterV2 + SwapRouter. Zero or thin `amountOut` is refused. There is no second DEX.

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

## Honesty

- Vault wealth is native 0G + W0G. Bridged USDC out of a Zia swap is **not** vault wealth.
- Router `verify_tee` / `x_0g_trace` is not an independent proof. Independent check is EIP-191 recover against the TEE signer (and SDK `processResponse` when the broker is configured).
- Hub swap UI “Powered By” a different factory is not Zia. Beacon pins Zia factory `0x6F3945Ab27296D1D66D8EEb042ff1B4fb2E0CE70`.
