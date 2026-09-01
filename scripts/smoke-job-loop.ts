import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { Interface, JsonRpcProvider, Wallet } from "ethers";
import {
  assertZeroGRequired,
  format0g,
  jobIdToBytes32,
  loadEnv,
  parse0g,
  resetEnvCache,
} from "@beacon/shared";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();
assertZeroGRequired(process.env, env);

const API = (process.env.BEACON_API_URL || "https://beacon-0g-api.onrender.com").replace(/\/$/, "");
const EXPLORER = env.ZEROG_EXPLORER.replace(/\/$/, "");
const ESCROW_ABI = new Interface(["function lockNative(bytes32 jobId) payable"]);

async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} ${res.status} ${text.slice(0, 400)}`);
  }
  return data as Record<string, unknown>;
}

function log(step: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ step, ...extra }));
}

async function pollJob(jobId: string, until: string[], ms = 8 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const row = await apiJson(`/v1/jobs/${jobId}`);
    const status = String((row.job as { status?: string } | undefined)?.status ?? row.status ?? "");
    log("poll", { status });
    if (until.includes(status)) return row;
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error("job poll timeout");
}

async function main() {
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK required");
  const health = await apiJson("/health");
  log("health", { chainId: health.chainId, api: API });

  const created = await apiJson("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      serviceId: "research",
      briefText: "One sentence: what is 0G Aristotle chain id 16661?",
    }),
  });
  const jobId = String(created.jobId);
  const quote = created.quote as {
    priceDisplay?: string;
    breakdown?: { model?: string };
    lock0g?: string;
    lock0gDisplay?: string;
    modelId?: string;
  };
  const lock0g = quote.lock0g ? BigInt(quote.lock0g) : parse0g(quote.priceDisplay || "0");
  const lockDisplay = quote.lock0gDisplay || format0g(lock0g);
  log("quoted", { jobId, lockDisplay, model: quote.modelId || quote.breakdown?.model });

  try {
    await apiJson(`/v1/jobs/${jobId}/review`, { method: "POST", body: "{}" });
  } catch (err) {
    log("review", { warning: err instanceof Error ? err.message : "review failed" });
  }

  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const wallet = new Wallet(pk, provider);
  const escrow = env.BEACON_JOB_ESCROW;
  if (!escrow) throw new Error("BEACON_JOB_ESCROW missing");
  if (lock0g <= 0n) throw new Error("quote lock0g is zero");
  const lockTx = await wallet.sendTransaction({
    to: escrow,
    data: ESCROW_ABI.encodeFunctionData("lockNative", [jobIdToBytes32(jobId)]),
    value: lock0g,
  });
  const mined = await lockTx.wait();
  if (mined?.status === 0) throw new Error("lockNative reverted");
  log("lock", { tx: `${EXPLORER}/tx/${lockTx.hash}`, bytes32: jobIdToBytes32(jobId) });

  await apiJson(`/v1/jobs/${jobId}/lock`, {
    method: "POST",
    body: JSON.stringify({ lockTx: lockTx.hash }),
  });

  try {
    await apiJson(`/v1/jobs/${jobId}/run`, { method: "POST", body: "{}" });
  } catch (err) {
    log("run-request", { note: err instanceof Error ? err.message.slice(0, 180) : "run http failed; polling" });
  }

  const afterRun = await pollJob(jobId, ["PASSED", "FAILED", "CLOSED"]);
  const status = String((afterRun.job as { status?: string } | undefined)?.status ?? afterRun.status);
  if (status === "FAILED") {
    throw new Error(`job failed: ${JSON.stringify(afterRun.denial ?? afterRun)}`);
  }

  if (status !== "CLOSED") {
    await apiJson(`/v1/jobs/${jobId}/release`, { method: "POST", body: "{}" });
  }
  const verify = await apiJson(`/v1/verify/${jobId}`);
  const onchain = verify.onchain as { storageRoot?: string; exists?: boolean } | null;
  const proof = {
    status: "REAL",
    api: API,
    jobId,
    bytes32: jobIdToBytes32(jobId),
    lockTx: `${EXPLORER}/tx/${lockTx.hash}`,
    verifyUrl: `https://beacon-0g.vercel.app/verify/${jobId}`,
    onchain,
    storageRoot: onchain?.storageRoot ?? afterRun.storageRoot,
    releaseTx: afterRun.releaseTx ?? (afterRun.explorer as { release?: string } | undefined)?.release,
    checkedAt: new Date().toISOString(),
  };
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/smoke-job-loop.json");
  writeFileSync(out, JSON.stringify(proof, null, 2));
  log("done", {
    jobId: proof.jobId,
    verifyUrl: proof.verifyUrl,
    storageRoot: proof.storageRoot,
    lockTx: proof.lockTx,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
