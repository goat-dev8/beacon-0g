import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { assertZeroGRequired, CHAIN_ID, format0g, loadEnv, parse0g, resetEnvCache } from "@beacon/shared";
import { fetchCatalog } from "@beacon/quote";
import { quoteJob } from "@beacon/quote";
import { chatCompletions, createComputeBroker } from "@beacon/compute";
import { quoteExactIn } from "@beacon/swap";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();
assertZeroGRequired(process.env, env);

const EXPLORER = env.ZEROG_EXPLORER.replace(/\/$/, "");
const proof: Record<string, unknown> = { chainId: env.CHAIN_ID, checkedAt: new Date().toISOString() };

function log(step: string, extra: Record<string, unknown> = {}) {
  const safe = { ...extra };
  for (const k of Object.keys(safe)) {
    const v = safe[k];
    if (typeof v === "string" && (v.startsWith("sk-") || v.length > 80 && /^0x[0-9a-fA-F]+$/.test(v) && v.length > 66)) {
      safe[k] = "[redacted]";
    }
  }
  console.log(JSON.stringify({ step, ...safe }));
}

async function main() {
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK required");
  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    throw new Error(`Wrong chain ${net.chainId}`);
  }
  const hexId = await provider.send("eth_chainId", []);
  if (hexId !== "0x4115") throw new Error(`eth_chainId ${hexId} != 0x4115`);
  proof.ethChainId = hexId;
  log("chain", { chainId: Number(net.chainId), ethChainId: hexId });

  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const image = quoteJob(catalog, { task: "image", briefText: "lighthouse", imageCount: 1 });
  const policy = quoteJob(catalog, { task: "policy", briefText: "allow image job" });
  const cheap = quoteJob(catalog, { task: "cheap", briefText: "classify" });
  proof.catalog = {
    hash: catalog.catalogHash,
    count: catalog.models.length,
    image: image.modelId,
    policy: policy.modelId,
    cheap: cheap.modelId,
    imageLock0g: format0g(image.lock0g),
  };
  log("catalog", proof.catalog as Record<string, unknown>);

  if (!env.COMPUTE_API_KEY) {
    proof.compute = { status: "NOT_AVAILABLE", reason: "COMPUTE_API_KEY missing" };
  } else {
    try {
      const ping = await chatCompletions({
        model: cheap.modelId,
        messages: [{ role: "user", content: "Reply with the single word pong." }],
        trustMode: cheap.selected.trustMode,
        maxTokens: 8,
        providerAddress: cheap.providerAddress || undefined,
      });
      proof.compute = {
        status: "REAL",
        model: ping.model,
        chatIdPresent: Boolean(ping.zgResKey || ping.chatId),
        zgResKeyPresent: Boolean(ping.zgResKey),
        provider: ping.providerAddress,
        usage: ping.usage,
      };
      log("compute", proof.compute as Record<string, unknown>);

      if (ping.providerAddress && ping.zgResKey) {
        try {
          const broker = await createComputeBroker(env);
          const ok = await broker.inference?.processResponse(
            ping.providerAddress,
            ping.zgResKey,
            JSON.stringify({ input_tokens: ping.usage.promptTokens, output_tokens: ping.usage.completionTokens }),
          );
          proof.tee = { processResponse: ok, provider: ping.providerAddress };
          log("tee", { processResponse: ok });
        } catch (err) {
          proof.tee = {
            status: "NOT_AVAILABLE",
            reason: err instanceof Error ? err.message.slice(0, 200) : "processResponse failed",
          };
          log("tee", proof.tee as Record<string, unknown>);
        }
      }
    } catch (err) {
      proof.compute = {
        status: "NOT_AVAILABLE",
        reason: err instanceof Error ? err.message.slice(0, 240) : "compute failed",
      };
      log("compute", proof.compute as Record<string, unknown>);
    }
  }

  const wallet = new Wallet(pk, provider);
  const factoryAddr = getAddress(env.BEACON_VAULT_FACTORY);
  const escrowAddr = getAddress(env.BEACON_JOB_ESCROW);
  const factory = new Interface([
    "function createSafe() returns (address)",
    "function safeOf(address) view returns (address)",
  ]);
  const vaultAbi = new Interface([
    "function deposit() payable",
    "function wealth() view returns (uint256)",
    "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce, uint256 value) returns (bytes)",
    "function executeNonce() view returns (uint256)",
  ]);
  const escrowAbi = new Interface([
    "function lockNative(bytes32 jobId) payable",
    "function refund(bytes32 jobId)",
    "function release(bytes32 jobId)",
    "function locks(bytes32) view returns (address payer, uint256 amount, bool released, bool refunded)",
  ]);

  const factoryC = new Contract(factoryAddr, factory, wallet);
  let safe = (await factoryC.safeOf(wallet.address)) as string;
  if (safe === "0x0000000000000000000000000000000000000000") {
    const tx = await wallet.sendTransaction({ to: factoryAddr, data: factory.encodeFunctionData("createSafe") });
    await tx.wait();
    safe = (await factoryC.safeOf(wallet.address)) as string;
    proof.createSafeTx = `${EXPLORER}/tx/${tx.hash}`;
    log("createSafe", { tx: tx.hash, safe });
  }
  proof.safe = safe;
  log("safe", { safe });

  const vault = new Contract(safe, vaultAbi, wallet);
  const depositWei = parse0g("0.05");
  const dep = await wallet.sendTransaction({
    to: safe,
    data: vaultAbi.encodeFunctionData("deposit"),
    value: depositWei,
  });
  await dep.wait();
  proof.safeFundingTx = `${EXPLORER}/tx/${dep.hash}`;
  log("deposit", { tx: dep.hash, wealth: format0g(await vault.wealth()) });

  const refundJob = keccak256(toUtf8Bytes(`beacon-refund-${Date.now()}`));
  const lockAmt = parse0g("0.02");
  const lockData = escrowAbi.encodeFunctionData("lockNative", [refundJob]);
  const nonce1 = ((await vault.executeNonce()) as bigint) + 1n;
  const lockTx = await vault.execute(escrowAddr, lockData, lockAmt, nonce1, lockAmt);
  await lockTx.wait();
  proof.jobLockTx = `${EXPLORER}/tx/${lockTx.hash}`;
  log("lock", { tx: lockTx.hash });

  const escrow = new Contract(escrowAddr, escrowAbi, wallet);
  const refundTx = await escrow.refund(refundJob);
  await refundTx.wait();
  proof.jobRefundTx = `${EXPLORER}/tx/${refundTx.hash}`;
  log("refund", { tx: refundTx.hash });

  const releaseJob = keccak256(toUtf8Bytes(`beacon-release-${Date.now()}`));
  const nonce2 = ((await vault.executeNonce()) as bigint) + 1n;
  const lock2 = await vault.execute(
    escrowAddr,
    escrowAbi.encodeFunctionData("lockNative", [releaseJob]),
    lockAmt,
    nonce2,
    lockAmt,
  );
  await lock2.wait();
  const releaseTx = await escrow.release(releaseJob);
  await releaseTx.wait();
  proof.jobReleaseTx = `${EXPLORER}/tx/${releaseTx.hash}`;
  log("release", { tx: releaseTx.hash });

  try {
    const zia = await quoteExactIn(parse0g("0.01"));
    proof.ziaQuote = {
      amountIn: zia.amountIn.toString(),
      amountOut: zia.amountOut.toString(),
      minOut: zia.minOut.toString(),
      impactBps: zia.impactBps,
      router: zia.router,
    };
    log("ziaQuote", proof.ziaQuote as Record<string, unknown>);
  } catch (err) {
    proof.ziaQuote = {
      status: "NOT_AVAILABLE",
      reason: err instanceof Error ? err.message.slice(0, 200) : "quote failed",
    };
    log("ziaQuote", proof.ziaQuote as Record<string, unknown>);
  }

  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/smoke-mainnet.json");
  writeFileSync(out, JSON.stringify(proof, null, 2));
  log("wrote", { out });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
