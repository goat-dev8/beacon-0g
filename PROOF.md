# Beacon 0G Aristotle — public proof (no secrets)

Checked 2026-09-01. Chain id 16661 (`eth_chainId` = `0x4115`). RPC https://evmrpc.0g.ai Explorer https://chainscan.0g.ai

## Chain
- 0G Aristotle mainnet
- Native asset: 0G (18 decimals)

## Contract addresses
| Contract | Address | Explorer |
|---|---|---|
| BeaconJobEscrow | `0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566` | https://chainscan.0g.ai/address/0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566 |
| BeaconReceiptRegistry | `0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887` | https://chainscan.0g.ai/address/0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887 |
| BeaconVaultFactory | `0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1` | https://chainscan.0g.ai/address/0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1 |
| Demo Beacon Safe | `0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30` | https://chainscan.0g.ai/address/0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30 |
| W0G | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` | https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c |
| Zia SwapRouter | `0x18cCa38E51c4C339A6BD6e174025f08360FEEf30` | https://chainscan.0g.ai/address/0x18cCa38E51c4C339A6BD6e174025f08360FEEf30 |
| Zia QuoterV2 | `0x23b55293b7F06F6c332a0dDA3D88d8921218425B` | https://chainscan.0g.ai/address/0x23b55293b7F06F6c332a0dDA3D88d8921218425B |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | https://chainscan.0g.ai/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 |

## Deployment TXs
- Escrow: https://chainscan.0g.ai/tx/0x09ae204b7de2dbc7b6f6e8ede3cf15dde929b26d5bb19fdd6dd7b6b3b4f76361
- Receipt registry: https://chainscan.0g.ai/tx/0xb7b11b8187c11274cb4b5fbb63c3eeeade5f5c753e7dab17ad195a66edffda10
- setRecorder: https://chainscan.0g.ai/tx/0xddd8c51844fd13814036dfd0066b01c9f81957c494fd76f1a71bb2a76b11f92a
- Factory: https://chainscan.0g.ai/tx/0x98cd458160352cd0a8395de0aa7addeaab90656967b74bc124ea3334082e0b34

## Safe create + funding
- createSafe: https://chainscan.0g.ai/tx/0x546e797fd7e4dd529680501867321016ecd8ea2685409cd70b1a90b86cb50edf
- deposit 0.05 0G: https://chainscan.0g.ai/tx/0x52ebe8921424e7f62bf762261af98955681d0f4b0791679a4a1a234ed482baae

## Job lock TX
- https://chainscan.0g.ai/tx/0x0f40e9b6753a26129c411b04454e0e1be220533fb47c20f3ec92fd82bff55142

## Job refund TX
- https://chainscan.0g.ai/tx/0x998a6f76de6a821e9290845e33eafe5baec343e9998f363d7054bb02bc255ac5

## Job release TX
- https://chainscan.0g.ai/tx/0xbcd1ac8fed6112adf94e36cdbd37d3b69aa44d44f5791916d1006e90d3f8c5bf

## Compute evidence
- Live Router `chat/completions` on `glm-5.3-flash` (TeeML provider `0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0`). `ZG-Res-Key` present. API key stays in gitignored `.env`.
- Live Router async image `z-image-turbo` job `c9ed19ad-5e1e-4290-818a-0269de4aaf60` (provider `0xE29a72c7629815Eb480aE5b1F2dfA06f06cdF974`). Content hash `0x0f62245fedfa075611ac5f04d29555806ec6ae74a034c24d7f3c65031f012903`.

## TEE verification
- SDK `processResponse` returned `true` on live `glm-5.3-flash`. Independent path (not Router `verify_tee`): on-chain `getService` → provider `/v1/proxy/signature/{chatID}` → EIP-191 recover. `eip191Ok: true`. Recovered signer `0x4C1b546f5Fc11A9c2428eaFEd1D951Aa13C17ee8` matched the on-chain TEE signer. Reproduce: `npm run smoke:tee`.

## Storage root
- Merkle root `0xefae47d0c7b3a416e85bf29112bd2b359658c8dd8f2ce346378e23c96b3270f0`
- Flow / indexer tx: https://chainscan.0g.ai/tx/0xec1753ac878eb0155d3a7f18fcfe656424c90e174a81053ecfb311afcf5b4620
- txSeq `211697`

## Storage Scan
- https://storagescan.0g.ai

## Receipt registry
- jobId `0xb1c5ac5abf0c7ff569c09939ce0620390fbbb41cc8ae400278af04070696ba77`
- record: https://chainscan.0g.ai/tx/0x3f7dd007deaa58d3894fcaeee707d604511bfeb7b422c0cbeae3560f26fdd9dd

## Zia quote
- QuoterV2 `quoteExactInput` W0G/USDC.e fee 3000. Live amountIn `0.01` 0G → amountOut `2481` (USDC.e 6 decimals).

## Zia transaction
- W0G.deposit: https://chainscan.0g.ai/tx/0xdbf703b8bac18dec2048d7110908550fe07b72ff45973ef1cdead24f4408f818
- W0G.approve: https://chainscan.0g.ai/tx/0xf16cc39234ca018b5a07b4f52cde2279e4638175c604bbf02a5f818a2d20c1d8
- SwapRouter `exactInputSingle`: https://chainscan.0g.ai/tx/0x9d964d7bb6415b0da0e17b7fcb7d65027ed77268a3cbbf05c3e7e0ab0e6d2cda

## ERC-8004 transaction
- `register()` on Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- https://chainscan.0g.ai/tx/0x0031c2c3e2ff668c92df778c003f49793b06513bd1e24c4fb16192142f54b023
- agentId `3531902` (`0x35e47e`)

## Demo wallet
- `0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf` (public address only; no keys in this file)

## Hosted surfaces
- API (Render): https://beacon-0g-api.onrender.com
- Web (Vercel): https://beacon-0g.vercel.app
- Health: https://beacon-0g-api.onrender.com/health
- Verify: https://beacon-0g.vercel.app/verify/0xb1c5ac5abf0c7ff569c09939ce0620390fbbb41cc8ae400278af04070696ba77
- Render static web was suspended; original Flare Beacon deploys were not modified.

## How to reproduce (no secrets in git)
```bash
npm run smoke:mainnet
npm run smoke:storage-swap
npm run smoke:erc8004
npm run smoke:tee
```
