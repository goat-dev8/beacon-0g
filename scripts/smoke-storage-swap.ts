import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { CHAIN_ID, format0g, loadEnv, parse0g, resetEnvCache } from "@beacon/shared";
import { putEvidence } from "@beacon/storage";
import { buildSwapTx, quoteExactIn } from "@beacon/swap";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();

const EXPLORER = env.ZEROG_EXPLORER.replace(/\/$/, "");
const proof: Record<string, unknown> = { chainId: env.CHAIN_ID, checkedAt: new Date().toISOString() };

function log(step: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ step, ...extra }));
}

async function main() {
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK required");
  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) throw new Error(`Wrong chain ${net.chainId}`);

  const packet = Buffer.from(
    JSON.stringify({
      kind: "beacon-0g-smoke-evidence",
      chainId: CHAIN_ID,
      at: new Date().toISOString(),
      note: "Encrypted job evidence packet for Storage turbo + Flow.submit.",
    }),
    "utf8",
  );
  const stored = await putEvidence(packet, { encrypt: true });
  proof.storage = {
    rootHash: stored.rootHash,
    txHash: stored.txHash,
    txSeq: stored.txSeq,
    encryptedBytes: stored.encryptedBytes,
    scan: stored.rootHash ? `https://storagescan.0g.ai/tx/${stored.rootHash}` : null,
    explorerTx: stored.txHash ? `${EXPLORER}/tx/${stored.txHash}` : null,
  };
  log("storage", proof.storage as Record<string, unknown>);

  const wallet = new Wallet(pk, provider);
  const factory = new Contract(
    getAddress(env.BEACON_VAULT_FACTORY),
    ["function safeOf(address) view returns (address)"],
    provider,
  );
  const safe = getAddress(await factory.safeOf(wallet.address));
  if (safe === "0x0000000000000000000000000000000000000000") {
    throw new Error("No Beacon Safe. Run smoke:mainnet first.");
  }
  proof.safe = safe;

  const vaultAbi = new Interface([
    "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce, uint256 value) returns (bytes)",
    "function executeNonce() view returns (uint256)",
    "function wealth() view returns (uint256)",
  ]);
  const vault = new Contract(safe, vaultAbi, wallet);
  const wealthBefore = (await vault.wealth()) as bigint;
  log("wealth", { wealth: format0g(wealthBefore) });

  const amountIn = parse0g("0.01");
  const quote = await quoteExactIn(amountIn);
  proof.ziaQuote = {
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minOut: quote.minOut.toString(),
    impactBps: quote.impactBps,
  };
  const built = buildSwapTx(quote, safe);
  const hashes: string[] = [];
  let nonce = BigInt(Date.now()) * 1000n;
  for (const call of built.executeCalls) {
    nonce += 1n;
    const tx = await vault.execute(call.target, call.data, call.maxSpend, nonce, call.value);
    const rec = await tx.wait();
    if (!rec) throw new Error("swap execute missing receipt");
    hashes.push(tx.hash);
    log("swapExecute", { tx: tx.hash, target: call.target, value: call.value.toString() });
  }
  proof.ziaSwapTxs = hashes.map((h) => `${EXPLORER}/tx/${h}`);
  proof.wealthAfter = format0g(await vault.wealth());

  const registryAddr = getAddress(env.BEACON_RECEIPT_REGISTRY);
  const registry = new Contract(
    registryAddr,
    [
      "function record(bytes32 jobId, bytes32 storageRoot, address teeSigner, bytes32 chatIdHash, bytes32 quoteHash, bool allowed)",
    ],
    wallet,
  );
  const jobId = keccak256(toUtf8Bytes(`beacon-receipt-${Date.now()}`));
  const recTx = await registry.record(
    jobId,
    stored.rootHash,
    wallet.address,
    keccak256(toUtf8Bytes("smoke-chat")),
    keccak256(toUtf8Bytes(JSON.stringify(proof.ziaQuote))),
    true,
  );
  await recTx.wait();
  proof.receiptRecordTx = `${EXPLORER}/tx/${recTx.hash}`;
  proof.receiptJobId = jobId;
  log("receipt", { tx: recTx.hash, jobId });

  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/smoke-storage-swap.json");
  writeFileSync(out, JSON.stringify(proof, null, 2));
  log("wrote", { out });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
