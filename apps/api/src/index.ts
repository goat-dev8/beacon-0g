import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { Interface, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";
import {
  aristotleEip1559Fees,
  AppError,
  JobStatus,
  CHAIN_ID,
  assertZeroGRequired,
  format0g,
  isAppError,
  jobIdToBytes32,
  loadEnv,
  newId,
  parse0g,
  transition,
} from "@beacon/shared";
import { fetchCatalog, quoteJob, selectModel, type JobQuote, type ModelTask } from "@beacon/quote";
import { chatCompletions, createComputeBroker, ensureLedgerBalance, type ComputeBroker } from "@beacon/compute";
import { reviewIntent } from "@beacon/tee";
import { putEvidence } from "@beacon/storage";
import { quoteExactIn, quoteZiaPair, buildSwapTx, listSwapAssets, findPoolFee, resolveZiaToken, parseSwapIntent, parseTokenAmount, formatTokenAmount } from "@beacon/swap";
import {
  createSafeSessionChallenge,
  verifyChallengeAndIssueSession,
  verifySafeSessionToken,
} from "./safeSession.js";
import { serviceIdToTask, webJobRow, webQuoteDto, ZEROG_SERVICES } from "./jobDesk.js";
import { openFlowHistory, redisClientFromEnv } from "./flowHistory.js";
import { getDurableJob, getDurableQuote, getLastJobId, listWalletJobIds, putDurableJob, putLastJobId } from "./jobPersist.js";
import { inspectAddress, inspectTransaction } from "./inspect.js";
import { BEACON_CAPABILITIES, capabilityCard } from "./capabilities.js";
import { BRIDGE_CATALOG, bridgeCatalogCard } from "./bridgeCatalog.js";
import { historyMeta } from "./historyMeta.js";
import { encodeGiveFeedback, probeErc8004 } from "./erc8004.js";
import { registerMcpRoutes } from "./mcpRoutes.js";
import { waitForMinedReceipt, type ReceiptLike } from "./waitTx.js";
import { classifyFlowIntent } from "./flowRouter.js";
import { parseBridgeIntent, quoteLifiBridge, statusLifiBridge } from "./lifiBridge.js";

const env = loadEnv();
assertZeroGRequired(process.env, env);

const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
const settler = env.SETTLER_PRIVATE_KEY ? new Wallet(env.SETTLER_PRIVATE_KEY, provider) : null;
let computeBroker: ComputeBroker | null = null;

async function requireBroker(): Promise<ComputeBroker> {
  if (!computeBroker) computeBroker = await createComputeBroker(env);
  return computeBroker;
}

async function aristotleFees() {
  return aristotleEip1559Fees({
    getGasPrice: async () => BigInt(await provider.send("eth_gasPrice", [])),
    send: (method, params) => provider.send(method, params ?? []),
  });
}

async function sendSettlerTx(tx: { to: string; data: string; value?: bigint }) {
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const fees = await aristotleFees();
  return settler.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
}

async function waitSettlerTx(tx: { hash: string; wait: (confirms?: number) => Promise<ReceiptLike | null> }) {
  return waitForMinedReceipt(tx, provider);
}

const ESCROW_ABI = new Interface([
  "function lockNative(bytes32 jobId) payable",
  "function release(bytes32 jobId)",
  "function refund(bytes32 jobId)",
  "function locks(bytes32) view returns (address payer, uint256 amount, bool released, bool refunded)",
]);
const RECEIPT_ABI = new Interface([
  "function record(bytes32 jobId, bytes32 storageRoot, address teeSigner, bytes32 chatIdHash, bytes32 quoteHash, bool allowed)",
  "function receipts(bytes32) view returns (bytes32 storageRoot, address teeSigner, bytes32 chatIdHash, bytes32 quoteHash, bool allowed, bool exists, uint256 recordedAt, address recorder)",
]);
const FACTORY_ABI = new Interface([
  "function createSafe() returns (address)",
  "function safeOf(address) view returns (address)",
  "function predictSafe(address) view returns (address)",
]);
const VAULT_ABI = new Interface([
  "function wealth() view returns (uint256)",
  "function owner() view returns (address)",
  "function executor() view returns (address)",
  "function paused() view returns (bool)",
  "function maxSpendPerTx() view returns (uint256)",
  "function rollingWindowBudget() view returns (uint256)",
  "function rollingWindowSeconds() view returns (uint256)",
  "function windowSpent() view returns (uint256)",
  "function windowStart() view returns (uint256)",
  "function sessionExpiresAt() view returns (uint256)",
  "function executeNonce() view returns (uint256)",
  "function allowedTargets(address) view returns (bool)",
  "function allowedSelectors(bytes4) view returns (bool)",
  "function setPaused(bool paused_)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function setPolicy(uint256 maxSpendPerTx_, uint256 rollingWindowBudget_, uint256 rollingWindowSeconds_, uint256 sessionExpiresAt_)",
  "function setExecutor(address newExecutor)",
  "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce, uint256 value) returns (bytes)",
]);
const ERC20_ABI = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

type StoredJob = {
  id: string;
  wallet: string;
  vault: string | null;
  task: ModelTask;
  brief: string;
  status: string;
  quote: JobQuote;
  tee?: Awaited<ReturnType<typeof reviewIntent>>;
  lockTx?: string;
  releaseTx?: string;
  refundTx?: string;
  receiptTx?: string;
  storageRoot?: string;
  resultText?: string;
  imageB64?: string;
  denial?: string;
  createdAt: string;
  serviceId?: string;
  payMode?: "safe" | "wallet";
  pipelineStarted?: boolean;
  events: Array<{ type: string; payload: unknown; ts: string }>;
};

const jobs = new Map<string, StoredJob>();
const quotes = new Map<string, JobQuote>();
const jobRedis = redisClientFromEnv(env);

async function persistJob(job: StoredJob): Promise<void> {
  jobs.set(job.id, job);
  quotes.set(job.quote.quoteId, job.quote);
  if (!jobRedis) return;
  try {
    await putDurableJob(jobRedis, job);
    if (job.wallet) await putLastJobId(jobRedis, job.wallet, job.id);
  } catch {
    /* Redis must not take down the request; GET hydrates on the next process. */
  }
}

function jobStayCards(job: StoredJob, title: string, summary: string) {
  return [
    {
      type: "job_offer",
      title,
      summary,
      jobId: job.id,
      quoteId: job.quote.quoteId,
      modelId: job.quote.modelId,
      lockDisplay: format0g(job.quote.lock0g),
      deskHref: `/flow/desk?job=${job.id}`,
      proofHref: `/verify/${job.id}`,
    },
  ];
}

async function lastJobForWallet(wallet?: string): Promise<StoredJob | undefined> {
  if (!wallet) return undefined;
  let addr: string;
  try {
    addr = getAddress(wallet);
  } catch {
    return undefined;
  }
  const mem = [...jobs.values()]
    .filter((j) => {
      try {
        return Boolean(j.wallet) && getAddress(j.wallet) === addr;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (mem) return mem;
  if (!jobRedis) return undefined;
  const id = await getLastJobId(jobRedis, addr);
  return id ? getJob(id) : undefined;
}

async function getJob(id: string): Promise<StoredJob | undefined> {
  const mem = jobs.get(id);
  if (mem) return mem;
  if (!jobRedis) return undefined;
  try {
    const stored = await getDurableJob<StoredJob>(jobRedis, id);
    if (!stored) return undefined;
    stored.events = stored.events ?? [];
    jobs.set(stored.id, stored);
    quotes.set(stored.quote.quoteId, stored.quote);
    if (stored.wallet) await putLastJobId(jobRedis, stored.wallet, stored.id).catch(() => {});
    return stored;
  } catch {
    return undefined;
  }
}

async function loadQuote(quoteId: string): Promise<JobQuote | undefined> {
  const mem = quotes.get(quoteId);
  if (mem) return mem;
  if (!jobRedis) return undefined;
  try {
    const stored = await getDurableQuote(jobRedis, quoteId);
    if (stored) quotes.set(quoteId, stored);
    return stored ?? undefined;
  } catch {
    return undefined;
  }
}

function explorerTx(hash: string): string {
  return `${env.ZEROG_EXPLORER.replace(/\/$/, "")}/tx/${hash}`;
}

function serializeQuote(q: JobQuote) {
  return {
    quoteId: q.quoteId,
    task: q.task,
    modelId: q.modelId,
    provider: q.providerAddress,
    verifiability: q.verifiability,
    catalogHash: q.catalogHash,
    lock0g: q.lock0g.toString(),
    lock0gDisplay: format0g(q.lock0g),
    modelCost0g: q.modelCost0g.toString(),
    storage0g: q.storage0g.toString(),
    service0g: q.service0g.toString(),
    total0g: q.total0g.toString(),
    usdHint: q.pricingUsdHint ?? null,
    expiresAt: q.expiresAt,
    quoteHash: q.quoteHash,
    reason: q.selected.reason,
  };
}

function serializeJob(job: StoredJob) {
  return {
    id: job.id,
    status: job.status,
    task: job.task,
    brief: job.brief,
    quote: serializeQuote(job.quote),
    tee: job.tee
      ? {
          allow: job.tee.allow,
          reason: job.tee.reason,
          category: job.tee.category,
          chatId: job.tee.chatId,
          processResponse: job.tee.processResponse,
          eip191Ok: job.tee.eip191Ok,
          recoveredSigner: job.tee.recoveredSigner,
          expectedSigner: job.tee.expectedSigner,
        }
      : null,
    lockTx: job.lockTx ?? null,
    releaseTx: job.releaseTx ?? null,
    refundTx: job.refundTx ?? null,
    receiptTx: job.receiptTx ?? null,
    storageRoot: job.storageRoot ?? null,
    storageScan: job.storageRoot
      ? `${env.ZEROG_STORAGE_SCAN.replace(/\/$/, "")}/?root=${job.storageRoot}`
      : null,
    resultText: job.resultText ?? null,
    imageB64: job.imageB64 ?? null,
    denial: job.denial ?? null,
    explorer: {
      lock: job.lockTx ? explorerTx(job.lockTx) : null,
      release: job.releaseTx ? explorerTx(job.releaseTx) : null,
      refund: job.refundTx ? explorerTx(job.refundTx) : null,
    },
  };
}

function emitEvent(job: StoredJob, type: string, payload: unknown) {
  job.events.push({ type, payload, ts: new Date().toISOString() });
  void persistJob(job);
}

function deskView(job: StoredJob) {
  return {
    ...serializeJob(job),
    job: webJobRow(job),
    quote: webQuoteDto(job.quote),
    recentEvents: job.events,
    paymentRail: {
      mode: job.payMode ?? "wallet",
      lockTxHash: job.lockTx ?? null,
      spendTxHash: job.releaseTx ?? null,
      payer: job.wallet,
      ownerWallet: job.wallet,
    },
    acceptance:
      job.status === JobStatus.PASSED || job.status === JobStatus.CLOSED
        ? { result: "PASS" as const, confidence: 1, summary: "Job passed. Paid in 0G." }
        : job.status === JobStatus.FAILED
          ? { result: "FAIL" as const, confidence: 1, summary: job.denial ?? "Failed. You were not charged." }
          : null,
  };
}

async function createQuotedJob(input: {
  wallet?: string;
  vault?: string;
  task: ModelTask;
  brief: string;
  quoteId?: string;
  serviceId?: string;
}): Promise<StoredJob> {
  if (input.task === "video" && !env.ENABLE_VIDEO) {
    throw new AppError("NO_FIT", {
      message: "Video is EXPERIMENTAL and disabled. Status: EXPERIMENTAL.",
    });
  }
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const quote =
    (input.quoteId ? await loadQuote(input.quoteId) : undefined) ??
    quoteJob(catalog, {
      task: input.task,
      briefText: input.brief,
      imageCount: input.task === "image" ? 1 : 0,
    });
  quotes.set(quote.quoteId, quote);
  const wallet = input.wallet ? getAddress(input.wallet) : "0x0000000000000000000000000000000000000000";
  const job: StoredJob = {
    id: newId(),
    wallet,
    vault: input.vault ? getAddress(input.vault) : null,
    task: input.task,
    brief: input.brief,
    status: JobStatus.QUOTED,
    quote,
    createdAt: new Date().toISOString(),
    serviceId: input.serviceId,
    events: [],
  };
  emitEvent(job, "quoted", { model: quote.modelId, lock0g: format0g(quote.lock0g) });
  await persistJob(job);
  return job;
}

async function policyTeeSpec() {
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const selected = selectModel(catalog, "policy");
  if (/image|whisper|seedance|turbo/i.test(selected.id)) {
    throw new AppError("TEE_DENIED", {
      message: "Policy review requires a chat TeeML model, not the job's image model.",
    });
  }
  return {
    model: selected.id,
    providerAddress: selected.address || undefined,
    trustMode: selected.trustMode,
  };
}

async function requireEscrow(): Promise<string> {
  const addr = env.BEACON_JOB_ESCROW?.trim();
  if (!addr) {
    throw new AppError("NOT_READY", { message: "BeaconJobEscrow is not deployed yet." });
  }
  return getAddress(addr);
}

const app = Fastify({ logger: { level: env.LOG_LEVEL } });
await app.register(cors, { origin: true });

const history = await openFlowHistory(env);
const historyReady = Boolean(history);
if (history) {
  app.log.info({ kind: history.kind }, "flow persistence ready");
} else {
  app.log.warn("flow persistence: no postgres and no Upstash — history will not survive restart");
}

app.get("/health", async () => ({
  ok: true,
  chainId: env.CHAIN_ID,
  network: env.NETWORK_NAME,
  asset: "native 0G",
  history: historyReady,
  historyKind: history?.kind ?? "none",
  jobs: Boolean(jobRedis),
  mcp: Boolean(jobRedis),
}));

app.get("/ready", async () => ({
  ok: true,
  escrow: env.BEACON_JOB_ESCROW || null,
  factory: env.BEACON_VAULT_FACTORY || null,
  receipts: env.BEACON_RECEIPT_REGISTRY || null,
  computeKey: Boolean(env.COMPUTE_API_KEY),
  settler: Boolean(settler),
  history: historyReady,
  historyKind: history?.kind ?? "none",
  jobs: Boolean(jobRedis),
}));

app.get("/v1/models", async () => {
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  return {
    catalogHash: catalog.catalogHash,
    fetchedAt: catalog.fetchedAt,
    count: catalog.models.length,
    models: catalog.models.map((m) => ({
      id: m.canonical_id,
      verifiability: m.verifiability,
      pricing: m.pricing,
      pricing_usd: m.pricing_usd ?? null,
      tools: (m.supported_parameters ?? []).includes("tools"),
    })),
  };
});

app.get("/v1/services", async () => ({ services: ZEROG_SERVICES }));

app.get("/v1/capabilities", async () => ({
  ok: true,
  items: BEACON_CAPABILITIES,
}));

app.get("/v1/inspect/address/:addr", async (req) => {
  const addr = String((req.params as { addr: string }).addr);
  return inspectAddress(provider, addr);
});

app.get("/v1/inspect/tx/:hash", async (req) => {
  const hash = String((req.params as { hash: string }).hash);
  return inspectTransaction(provider, hash);
});

app.get("/v1/swap/assets", async () => listSwapAssets({ env }));

app.get("/v1/bridge/catalog", async () => ({
  ok: true,
  executableFromBeaconSafe: false,
  routes: BRIDGE_CATALOG,
  honesty:
    "Official 0G docs: XSwap (CCIP) and LI.FI (chain key zerog). Beacon Safe cannot sign a source-chain tx. Say “Bridge 1 USDC from Base to 0G” for a live LI.FI quote.",
}));

app.post("/v1/bridge/quote", async (req) => {
  const body = z
    .object({
      text: z.string().min(1).max(500),
      wallet: z.string().min(42),
    })
    .parse(req.body);
  const intent = parseBridgeIntent(body.text);
  if (!intent) {
    throw new AppError("NO_FIT", {
      message: "Name a source chain Beacon can quote (Base or Ethereum) and an amount, e.g. Bridge 1 USDC from Base to 0G.",
    });
  }
  return quoteLifiBridge(intent, getAddress(body.wallet));
});

app.get("/v1/bridge/status", async (req) => {
  const q = req.query as { txHash?: string; fromChainId?: string };
  if (!q.txHash || !q.fromChainId) {
    throw new AppError("VALIDATION", { message: "txHash and fromChainId are required." });
  }
  return statusLifiBridge(q.txHash, Number(q.fromChainId));
});

app.post("/v1/quote", async (req) => {
  const body = z
    .object({
      task: z.enum(["policy", "cheap", "vision", "image", "video", "stt"]).default("image"),
      brief: z.string().min(1).max(8000),
    })
    .parse(req.body);
  if (body.task === "video" && !env.ENABLE_VIDEO) {
    throw new AppError("NO_FIT", {
      message: "Video is EXPERIMENTAL and disabled. Status: EXPERIMENTAL.",
    });
  }
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const quote = quoteJob(catalog, {
    task: body.task,
    briefText: body.brief,
    imageCount: body.task === "image" ? 1 : 0,
  });
  quotes.set(quote.quoteId, quote);
  return serializeQuote(quote);
});

app.post("/v1/jobs", async (req) => {
  const body = z
    .object({
      wallet: z.string().optional(),
      vault: z.string().optional(),
      task: z.enum(["policy", "cheap", "vision", "image", "video", "stt"]).optional(),
      brief: z.string().max(8000).optional(),
      briefText: z.string().max(8000).optional(),
      serviceId: z.string().optional(),
      quoteId: z.string().optional(),
    })
    .parse(req.body);
  const brief = (body.briefText || body.brief || "").trim();
  if (!brief) throw new AppError("VALIDATION", { message: "brief is required." });
  const task = body.task ?? (body.serviceId ? serviceIdToTask(body.serviceId) : "image");
  const job = await createQuotedJob({
    wallet: body.wallet,
    vault: body.vault,
    task,
    brief,
    quoteId: body.quoteId,
    serviceId: body.serviceId,
  });
  return { jobId: job.id, ...deskView(job) };
});

app.get("/v1/jobs/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  return deskView(job);
});

app.post("/v1/jobs/:id/quote", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  return { jobId: job.id, quote: webQuoteDto(job.quote), offerId: job.quote.quoteId };
});

app.post("/v1/jobs/:id/approve", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  const body = z
    .object({
      offerId: z.string().optional(),
      mode: z.string().optional(),
      lockTxHash: z.string().optional(),
      authorization: z
        .object({
          lockTxHash: z.string().optional(),
          payer: z.string().optional(),
        })
        .optional(),
    })
    .parse(req.body);
  const lockTx = body.lockTxHash || body.authorization?.lockTxHash;
  if (!lockTx || !/^0x[0-9a-fA-F]{64}$/.test(lockTx)) {
    throw new AppError("PAYMENT_REQUIRED", { message: "Native 0G lock tx is required." });
  }
  if (body.authorization?.payer) job.wallet = getAddress(body.authorization.payer);
  job.lockTx = lockTx;
  job.payMode = "wallet";
  job.status = JobStatus.AUTHORIZED;
  emitEvent(job, "locked", { tx: lockTx, mode: "wallet" });
  await persistJob(job);
  void pipelineAfterLock(job);
  return {
    jobId: job.id,
    status: job.status,
    offerId: job.quote.quoteId,
    mode: "wallet",
    lockTxHash: lockTx,
    spendTxHash: null,
  };
});

app.post("/v1/jobs/:id/approve-safe", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const body = z
    .object({
      offerId: z.string().optional(),
      ownerWallet: z.string().min(42),
    })
    .parse(req.body);
  const session = verifySafeSessionToken(auth, body.ownerWallet, env.SESSION_SECRET);
  if (!session) throw new AppError("UNAUTHORIZED", { message: "Safe session is missing or expired." });
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const owner = getAddress(body.ownerWallet);
  const safe = await resolveSafe(owner);
  if (!safe) throw new AppError("NOT_READY", { message: "No Beacon Safe for this wallet." });
  const escrow = await requireEscrow();
  const nonceRaw = await provider.call({
    to: safe,
    data: VAULT_ABI.encodeFunctionData("executeNonce"),
  });
  const [lastNonce] = VAULT_ABI.decodeFunctionResult("executeNonce", nonceRaw);
  const nonce = BigInt(lastNonce) + 1n;
  const lockData = ESCROW_ABI.encodeFunctionData("lockNative", [jobIdToBytes32(job.id)]);
  const execData = VAULT_ABI.encodeFunctionData("execute", [
    escrow,
    lockData,
    job.quote.lock0g,
    nonce,
    job.quote.lock0g,
  ]);
  const tx = await sendSettlerTx({ to: safe, data: execData });
  const mined = await waitSettlerTx(tx);
  if (Number(mined.status ?? 1) === 0) {
    throw new AppError("PAYMENT_FAILED", { message: "Safe lockNative reverted." });
  }
  job.wallet = owner;
  job.vault = safe;
  job.lockTx = tx.hash;
  job.payMode = "safe";
  job.status = JobStatus.AUTHORIZED;
  emitEvent(job, "locked", { tx: tx.hash, mode: "safe", vault: safe });
  await persistJob(job);
  void pipelineAfterLock(job);
  return {
    jobId: job.id,
    status: job.status,
    offerId: job.quote.quoteId,
    mode: "safe",
    vault: safe,
    lockTxHash: tx.hash,
    spendTxHash: tx.hash,
    explorerLock: explorerTx(tx.hash),
    explorerSpend: explorerTx(tx.hash),
  };
});

app.get("/v1/jobs/:id/events", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("connected", { ok: true, jobId: id });
  const tick = setInterval(() => {
    const current = jobs.get(id);
    if (!current) {
      clearInterval(tick);
      reply.raw.end();
      return;
    }
    const last = current.events[current.events.length - 1];
    send("message", last ?? { type: "heartbeat", payload: { status: current.status } });
    send("heartbeat", { status: current.status });
    if (
      current.status === JobStatus.CLOSED ||
      current.status === JobStatus.FAILED ||
      current.status === JobStatus.EXPIRED
    ) {
      clearInterval(tick);
      reply.raw.end();
    }
  }, 1500);
  req.raw.on("close", () => {
    clearInterval(tick);
  });
});

app.get("/v1/jobs/:id/artifacts", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  const artifacts = [];
  if (job.imageB64) {
    artifacts.push({
      id: "image",
      kind: "image",
      uri: `data:image/png;base64,${job.imageB64}`,
      sha256: job.resultText ?? null,
      meta: { model: job.quote.modelId },
    });
  } else if (job.resultText) {
    artifacts.push({
      id: "text",
      kind: "document",
      uri: "inline",
      sha256: null,
      meta: { model: job.quote.modelId, preview: job.resultText.slice(0, 500) },
    });
  }
  return { jobId: job.id, artifacts };
});

app.get("/v1/jobs/:id/artifacts/:artifactId/raw", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const artifactId = (req.params as { artifactId: string }).artifactId;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  if (artifactId === "image" && job.imageB64) {
    const bytes = Buffer.from(job.imageB64, "base64");
    return reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=300")
      .header("Content-Length", String(bytes.length))
      .send(bytes);
  }
  throw new AppError("JOB_NOT_FOUND", { message: "Artifact is not available as bytes." });
});

app.get("/v1/jobs/:id/artifacts/:artifactId", async (req) => {
  const id = (req.params as { id: string }).id;
  const artifactId = (req.params as { artifactId: string }).artifactId;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  if (artifactId === "image" && job.imageB64) {
    return {
      id: "image",
      kind: "image",
      mimeType: "image/png",
      content: job.imageB64,
      truncated: false,
      available: true,
    };
  }
  return {
    id: artifactId,
    kind: "text",
    mimeType: "text/plain",
    content: job.resultText ?? null,
    truncated: false,
    available: Boolean(job.resultText),
  };
});

app.get("/v1/jobs/:id/receipt", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  return {
    jobId: job.id,
    receipt: job.releaseTx
      ? {
          id: job.id,
          txHash: job.releaseTx,
          payment: { txHash: job.releaseTx, settled: true, amountUsdt0: format0g(job.quote.lock0g) },
          accept: { result: "PASS" as const },
          display: { statusLabel: "Released", priceDisplay: format0g(job.quote.lock0g) },
        }
      : null,
  };
});

app.post("/v1/jobs/:id/look", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  return { jobId: job.id, status: job.status };
});

app.post("/v1/jobs/:id/review", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  const broker = await requireBroker();
  const policy = await policyTeeSpec();
  const tee = await reviewIntent(
    {
      userText: job.brief,
      tool: job.task,
      amount0g: format0g(job.quote.lock0g),
      target: env.BEACON_JOB_ESCROW || "escrow",
      model: policy.model,
      providerAddress: policy.providerAddress,
      trustMode: policy.trustMode,
    },
    { env, broker },
  );
  job.tee = tee;
  if (!tee.allow) {
    job.status = JobStatus.FAILED;
    job.denial = tee.reason;
  }
  await persistJob(job);
  return serializeJob(job);
});

app.post("/v1/jobs/:id/lock", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  if (job.tee && !job.tee.allow) {
    throw new AppError("TEE_DENIED", { message: job.tee.reason });
  }
  const body = z.object({ lockTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
  job.lockTx = body.lockTx;
  job.status = transition(job.status as typeof JobStatus.QUOTED, "user_approve");
  emitEvent(job, "locked", { tx: job.lockTx });
  await persistJob(job);
  return deskView(job);
});

async function runLockedJob(job: StoredJob): Promise<StoredJob> {
  if (!job.lockTx) {
    throw new AppError("PAYMENT_REQUIRED", { message: "Lock native 0G in BeaconJobEscrow first." });
  }
  try {
    if (!job.tee) {
      const policy = await policyTeeSpec();
      const broker = await requireBroker();
      job.tee = await reviewIntent(
        {
          userText: job.brief,
          tool: job.task,
          amount0g: format0g(job.quote.lock0g),
          target: env.BEACON_JOB_ESCROW || "escrow",
          model: policy.model,
          providerAddress: policy.providerAddress,
          trustMode: policy.trustMode,
        },
        { env, broker },
      );
      await persistJob(job);
      if (!job.tee.allow) {
        job.status = JobStatus.FAILED;
        job.denial = job.tee.reason;
        emitEvent(job, "denied", { reason: job.tee.reason });
        throw new AppError("TEE_DENIED", { message: job.tee.reason });
      }
    } else if (!job.tee.allow) {
      throw new AppError("TEE_DENIED", { message: job.tee.reason });
    }
    job.status = JobStatus.GENERATING;
    emitEvent(job, "thinking", { text: `Running ${job.quote.modelId} on 0G Compute.` });
    const broker = await requireBroker();
    const minLedger =
      job.quote.lock0g > parse0g("0.05") ? job.quote.lock0g : parse0g("0.05");
    try {
      await ensureLedgerBalance(minLedger, { env, broker });
    } catch (err) {
      throw new AppError("INSUFFICIENT_TREASURY", {
        message:
          "0G Compute treasury could not pay the provider. This is not your Safe balance. Escrow refunds.",
        cause: err,
      });
    }
    if (job.task === "image") {
      const { generateImage } = await import("@beacon/compute");
      const img = await generateImage({
        model: job.quote.modelId,
        prompt: job.brief,
        trustMode: job.quote.selected.trustMode,
        providerAddress: job.quote.providerAddress || undefined,
      });
      job.resultText = img.contentHash;
      job.imageB64 = img.b64Json;
    } else {
      const completion = await chatCompletions({
        model: job.quote.modelId,
        messages: [{ role: "user", content: job.brief }],
        trustMode: job.quote.selected.trustMode,
        providerAddress: job.quote.providerAddress || undefined,
      });
      job.resultText = completion.content;
    }

    emitEvent(job, "thinking", { text: "Encrypting evidence and uploading to 0G Storage." });
    const packet = Buffer.from(
      JSON.stringify({
        jobId: job.id,
        model: job.quote.modelId,
        quoteHash: job.quote.quoteHash,
        briefHash: keccak256(toUtf8Bytes(job.brief)),
        result: job.resultText?.slice(0, 4000),
        lockTx: job.lockTx,
      }),
      "utf8",
    );
    try {
      const stored = await putEvidence(packet, { encrypt: true });
      job.storageRoot = stored.rootHash;
    } catch (err) {
      job.status = JobStatus.FAILED;
      emitEvent(job, "failed", { reason: "storage" });
      throw new AppError("STORAGE_FAILED", {
        message: err instanceof Error ? err.message : "0G Storage upload failed. You were not charged.",
      });
    }
    job.status = JobStatus.PASSED;
    emitEvent(job, "thinking", { text: "Storage root recorded. Releasing escrow." });
    return job;
  } catch (err) {
    job.status = JobStatus.FAILED;
    if (isAppError(err)) throw err;
    const raw = err instanceof Error ? err.message : "";
    if (/insufficient balance/i.test(raw)) {
      throw new AppError("INSUFFICIENT_TREASURY", {
        message:
          "0G Compute treasury could not pay the provider. This is not your Safe balance. Escrow refunds.",
        cause: err,
      });
    }
    throw new AppError("PIPELINE_FAILED", {
      message: "Generation failed. You were not charged.",
      cause: err,
    });
  }
}

async function releasePassedJob(job: StoredJob): Promise<ReturnType<typeof deskView>> {
  if (job.status !== JobStatus.PASSED) {
    throw new AppError("INVALID_TRANSITION", { message: "Release requires a passed job." });
  }
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const escrow = await requireEscrow();
  const tx = await sendSettlerTx({
    to: escrow,
    data: ESCROW_ABI.encodeFunctionData("release", [jobIdToBytes32(job.id)]),
  });
  job.releaseTx = tx.hash;
  await persistJob(job);
  await waitSettlerTx(tx);

  if (env.BEACON_RECEIPT_REGISTRY) {
    const receiptTx = await sendSettlerTx({
      to: env.BEACON_RECEIPT_REGISTRY,
      data: RECEIPT_ABI.encodeFunctionData("record", [
        jobIdToBytes32(job.id),
        job.storageRoot || keccak256(toUtf8Bytes("empty")),
        job.tee?.providerAddress || settler.address,
        keccak256(toUtf8Bytes(job.tee?.chatId || "")),
        job.quote.quoteHash,
        true,
      ]),
    });
    job.receiptTx = receiptTx.hash;
    await persistJob(job);
    await waitSettlerTx(receiptTx);
  }
  job.status = JobStatus.CLOSED;
  emitEvent(job, "released", { tx: job.releaseTx, receiptTx: job.receiptTx });
  return deskView(job);
}

async function pipelineAfterLock(job: StoredJob): Promise<void> {
  if (job.pipelineStarted) return;
  job.pipelineStarted = true;
  await persistJob(job);
  try {
    if (!job.tee) {
      const broker = await requireBroker();
      const policy = await policyTeeSpec();
      job.tee = await reviewIntent(
        {
          userText: job.brief,
          tool: job.task,
          amount0g: format0g(job.quote.lock0g),
          target: env.BEACON_JOB_ESCROW || "escrow",
          model: policy.model,
          providerAddress: policy.providerAddress,
          trustMode: policy.trustMode,
        },
        { env, broker },
      );
      if (!job.tee.allow) {
        job.status = JobStatus.FAILED;
        job.denial = job.tee.reason;
        emitEvent(job, "denied", { reason: job.tee.reason });
        if (settler && job.lockTx) {
          const escrow = await requireEscrow();
          const tx = await sendSettlerTx({
            to: escrow,
            data: ESCROW_ABI.encodeFunctionData("refund", [jobIdToBytes32(job.id)]),
          });
          job.refundTx = tx.hash;
          await persistJob(job);
          await waitSettlerTx(tx);
          job.status = JobStatus.CLOSED;
          emitEvent(job, "refunded", { tx: job.refundTx });
        }
        await persistJob(job);
        return;
      }
      await persistJob(job);
    }
    await runLockedJob(job);
    await releasePassedJob(job);
  } catch (err) {
    job.status = JobStatus.FAILED;
    job.denial = err instanceof Error ? err.message : "pipeline failed";
    emitEvent(job, "failed", { message: job.denial });
    try {
      if (settler && job.lockTx && !job.releaseTx && !job.refundTx) {
        const escrow = await requireEscrow();
        const tx = await sendSettlerTx({
          to: escrow,
          data: ESCROW_ABI.encodeFunctionData("refund", [jobIdToBytes32(job.id)]),
        });
        job.refundTx = tx.hash;
        await persistJob(job);
        await waitSettlerTx(tx);
        job.status = JobStatus.CLOSED;
        emitEvent(job, "refunded", { tx: job.refundTx });
      }
    } catch {
      /* refund best-effort */
    }
  } finally {
    await persistJob(job);
  }
}

app.post("/v1/jobs/:id/run", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  await runLockedJob(job);
  return deskView(job);
});

app.post("/v1/jobs/:id/refund", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const escrow = await requireEscrow();
  const tx = await sendSettlerTx({
    to: escrow,
    data: ESCROW_ABI.encodeFunctionData("refund", [jobIdToBytes32(job.id)]),
  });
  job.refundTx = tx.hash;
  await persistJob(job);
  await waitSettlerTx(tx);
  job.status = JobStatus.CLOSED;
  emitEvent(job, "refunded", { tx: job.refundTx });
  return deskView(job);
});

app.post("/v1/jobs/:id/release", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  if (!job) throw new AppError("JOB_NOT_FOUND");
  return releasePassedJob(job);
});

app.get("/v1/verify/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const job = await getJob(id);
  let onchain: unknown = null;
  if (env.BEACON_RECEIPT_REGISTRY) {
    const contract = { address: env.BEACON_RECEIPT_REGISTRY };
    try {
      const data = RECEIPT_ABI.encodeFunctionData("receipts", [jobIdToBytes32(id)]);
      const raw = await provider.call({ to: contract.address, data });
      const decoded = RECEIPT_ABI.decodeFunctionResult("receipts", raw);
      const exists = Boolean(decoded.exists ?? decoded[5]);
      onchain = exists
        ? {
            storageRoot: String(decoded.storageRoot ?? decoded[0]),
            teeSigner: String(decoded.teeSigner ?? decoded[1]),
            chatIdHash: String(decoded.chatIdHash ?? decoded[2]),
            quoteHash: String(decoded.quoteHash ?? decoded[3]),
            allowed: Boolean(decoded.allowed ?? decoded[4]),
            exists,
            recordedAt: (decoded.recordedAt ?? decoded[6]).toString(),
            recorder: String(decoded.recorder ?? decoded[7]),
          }
        : null;
    } catch {
      onchain = null;
    }
  }
  return {
    chainId: env.CHAIN_ID,
    explorer: env.ZEROG_EXPLORER,
    job: job ? serializeJob(job) : null,
    onchain,
    note: job ? null : "Job not in this API memory. On-chain receipt is authoritative if recorded.",
  };
});

app.get("/v1/safe/:owner", async (req) => {
  const owner = getAddress((req.params as { owner: string }).owner);
  if (!env.BEACON_VAULT_FACTORY) {
    return { factory: null, safe: null, status: "NOT_AVAILABLE" };
  }
  const data = FACTORY_ABI.encodeFunctionData("safeOf", [owner]);
  const raw = await provider.call({ to: env.BEACON_VAULT_FACTORY, data });
  const [safe] = FACTORY_ABI.decodeFunctionResult("safeOf", raw);
  if (safe === "0x0000000000000000000000000000000000000000") {
    const pred = await provider.call({
      to: env.BEACON_VAULT_FACTORY,
      data: FACTORY_ABI.encodeFunctionData("predictSafe", [owner]),
    });
    const [predicted] = FACTORY_ABI.decodeFunctionResult("predictSafe", pred);
    return { factory: env.BEACON_VAULT_FACTORY, safe: null, predicted, createData: FACTORY_ABI.encodeFunctionData("createSafe") };
  }
  const wealthRaw = await provider.call({ to: safe, data: VAULT_ABI.encodeFunctionData("wealth") });
  const [wealth] = VAULT_ABI.decodeFunctionResult("wealth", wealthRaw);
  const pausedRaw = await provider.call({ to: safe, data: VAULT_ABI.encodeFunctionData("paused") });
  const [paused] = VAULT_ABI.decodeFunctionResult("paused", pausedRaw);
  return {
    factory: env.BEACON_VAULT_FACTORY,
    safe,
    wealth: wealth.toString(),
    wealthDisplay: format0g(wealth),
    paused,
  };
});

function amountLabel(wei: bigint): string {
  return format0g(wei).replace(/ 0G$/, "");
}

async function vaultView(safe: string, fn: string, args: unknown[] = []) {
  const data = VAULT_ABI.encodeFunctionData(fn, args);
  const raw = await provider.call({ to: safe, data });
  return VAULT_ABI.decodeFunctionResult(fn, raw);
}

async function resolveSafe(owner: string): Promise<string | null> {
  if (!env.BEACON_VAULT_FACTORY) return null;
  const raw = await provider.call({
    to: env.BEACON_VAULT_FACTORY,
    data: FACTORY_ABI.encodeFunctionData("safeOf", [owner]),
  });
  const [safe] = FACTORY_ABI.decodeFunctionResult("safeOf", raw);
  if (safe === "0x0000000000000000000000000000000000000000") return null;
  return getAddress(safe);
}

function bearerToken(req: { headers: { authorization?: string } }): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function requireWalletSession(req: { headers: { authorization?: string } }, wallet: string) {
  const token = bearerToken(req);
  if (!token) throw new AppError("UNAUTHORIZED");
  const session = verifySafeSessionToken(token, wallet, env.SESSION_SECRET);
  if (!session) throw new AppError("UNAUTHORIZED");
  return session;
}

type AppPolicy = {
  dailySpendUsdt0: number;
  perJobLimitUsdt0: number;
  allowedAgents: string[];
  allowedChains: number[];
  maxImageCostUsdt0: number;
  emergencyPause: boolean;
  sessionExpiryHours: number;
  maxVideoSeconds: number;
};

const DEFAULT_APP_POLICY: AppPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 10,
  allowedAgents: [
    "general",
    "signals",
    "intel",
    "portfolio",
    "swap",
    "research",
    "desk",
    "image",
    "pay",
    "risk",
    "treasury",
  ],
  allowedChains: [CHAIN_ID],
  maxImageCostUsdt0: 0.05,
  emergencyPause: false,
  sessionExpiryHours: 24,
  maxVideoSeconds: 60,
};

const appPolicies = new Map<string, AppPolicy>();

app.post("/v1/auth/safe-session/challenge", async (req) => {
  const body = z.object({ wallet: z.string().min(42) }).parse(req.body);
  const challenge = createSafeSessionChallenge(body.wallet, env.SESSION_SECRET);
  return { ok: true as const, ...challenge, scope: "jobs+zia" };
});

app.post("/v1/auth/safe-session/verify", async (req) => {
  const body = z
    .object({ wallet: z.string().min(42), message: z.string(), signature: z.string() })
    .parse(req.body);
  const issued = verifyChallengeAndIssueSession({
    wallet: body.wallet,
    message: body.message,
    signature: body.signature,
    secret: env.SESSION_SECRET,
  });
  if (!issued) throw new AppError("UNAUTHORIZED", { message: "Safe session signature was rejected." });
  return {
    ok: true as const,
    token: issued.token,
    wallet: issued.session.wallet,
    issuedAt: issued.session.issuedAt,
    expiresAt: issued.session.expiresAt,
  };
});

app.get("/v1/vault/status", async (req) => {
  const q = req.query as { wallet?: string; address?: string };
  const wallet = q.wallet ? getAddress(q.wallet) : null;
  if (!env.BEACON_VAULT_FACTORY) {
    return {
      ok: true,
      status: {
        configured: false,
        readiness: "factory-missing",
        address: null,
        note: "BeaconVaultFactory is not configured.",
        honesty: "No Safe until the factory is deployed on Aristotle.",
        distinction: "Beacon Safe is a native 0G vault, not a Flare AgentVault.",
        factory: null,
        wallet,
      },
    };
  }
  const owner = wallet ?? (q.address ? getAddress(q.address) : null);
  if (!owner) {
    return {
      ok: true,
      status: {
        configured: false,
        readiness: "no-wallet",
        address: null,
        note: "Connect a wallet to load Beacon Safe.",
        honesty: "Status is on-chain. Nothing is invented.",
        distinction: "Beacon Safe holds native 0G.",
        factory: env.BEACON_VAULT_FACTORY,
        wallet: null,
      },
    };
  }
  const safe = q.address && q.address.startsWith("0x") && q.address.length === 42 && !q.wallet
    ? getAddress(q.address)
    : await resolveSafe(owner);
  if (!safe) {
    return {
      ok: true,
      status: {
        configured: false,
        readiness: "not-created",
        address: null,
        note: "No Beacon Safe for this wallet yet. Create one from this page.",
        honesty: "createSafe is a real factory tx on Aristotle.",
        distinction: "One Safe per wallet.",
        factory: env.BEACON_VAULT_FACTORY,
        wallet: owner,
        code: "NOT_CREATED",
      },
    };
  }
  const [wealth] = await vaultView(safe, "wealth");
  const [vaultOwner] = await vaultView(safe, "owner");
  const [executor] = await vaultView(safe, "executor");
  const [paused] = await vaultView(safe, "paused");
  const [maxSpend] = await vaultView(safe, "maxSpendPerTx");
  const [windowBudget] = await vaultView(safe, "rollingWindowBudget");
  const [windowSeconds] = await vaultView(safe, "rollingWindowSeconds");
  const [windowSpent] = await vaultView(safe, "windowSpent");
  const [windowStart] = await vaultView(safe, "windowStart");
  const [sessionExpiresAt] = await vaultView(safe, "sessionExpiresAt");
  const [executeNonce] = await vaultView(safe, "executeNonce");
  const now = Math.floor(Date.now() / 1000);
  const sessionExp = Number(sessionExpiresAt);
  const ziaOk = Boolean((await vaultView(safe, "allowedTargets", [env.ZIA_ROUTER]))[0]);
  const w0gOk = Boolean((await vaultView(safe, "allowedTargets", [env.ZEROG_W0G]))[0]);
  return {
    ok: true,
    status: {
      configured: true,
      address: safe,
      network: env.NETWORK_NAME,
      chainId: env.CHAIN_ID,
      token: "native",
      tokenSymbol: "0G",
      tokenDecimals: 18,
      balance: wealth.toString(),
      balanceDisplay: amountLabel(wealth as bigint),
      owner: String(vaultOwner),
      executor: String(executor),
      paused: Boolean(paused),
      maxSpendPerTxDisplay: amountLabel(maxSpend as bigint),
      rollingWindowBudgetDisplay: amountLabel(windowBudget as bigint),
      rollingWindowSeconds: (windowSeconds as bigint).toString(),
      windowSpentDisplay: amountLabel(windowSpent as bigint),
      windowStart: (windowStart as bigint).toString(),
      sessionExpiresAt: sessionExp,
      sessionExpiresAtIso: sessionExp > 0 ? new Date(sessionExp * 1000).toISOString() : null,
      sessionActive: sessionExp === 0 || sessionExp > now,
      executeNonce: (executeNonce as bigint).toString(),
      allowlists: {
        targets: [
          { address: env.ZIA_ROUTER, allowed: ziaOk },
          { address: env.ZEROG_W0G, allowed: w0gOk },
        ],
        selectors: [{ selector: "0x414bf389", allowed: true }],
        note: "Factory allowlists W0G wrap/approve, Job Escrow lockNative, and Zia exactInputSingle.",
      },
      explorer: `${env.ZEROG_EXPLORER.replace(/\/$/, "")}/address/${safe}`,
      honesty: "Wealth is native 0G + W0G. USDC.e is ignored on purpose.",
      distinction: "Executor spends; TeeML never holds a key.",
      factory: env.BEACON_VAULT_FACTORY,
      wallet: owner,
      isOwner: wallet ? wallet.toLowerCase() === String(vaultOwner).toLowerCase() : false,
    },
  };
});

app.post("/v1/vault/prepare", async (req) => {
  const body = z
    .object({
      action: z.enum(["deposit", "withdraw", "setPolicy", "setPaused", "setExecutor", "createSafe"]),
      address: z.string().optional(),
      wallet: z.string().optional(),
      amountUsdt0: z.string().optional(),
      maxSpendPerTxUsdt0: z.string().optional(),
      rollingWindowBudgetUsdt0: z.string().optional(),
      rollingWindowSeconds: z.number().int().positive().optional(),
      sessionExpiresAt: z.number().int().nonnegative().optional(),
      paused: z.boolean().optional(),
      executor: z.string().optional(),
      revoke: z.boolean().optional(),
    })
    .parse(req.body);
  if (!env.BEACON_VAULT_FACTORY) throw new AppError("NOT_READY", { message: "Factory is not configured." });
  if (body.action === "createSafe") {
    return {
      ok: true,
      prep: {
        action: "createSafe",
        chainId: env.CHAIN_ID,
        network: env.NETWORK_NAME,
        to: env.BEACON_VAULT_FACTORY,
        data: FACTORY_ABI.encodeFunctionData("createSafe"),
        value: "0",
        ownerOnly: false,
        note: "Create your Beacon Safe. One per wallet.",
        honesty: "Factory sets Zia + escrow allowlists, then transfers ownership to you.",
      },
    };
  }
  const owner = getAddress(body.wallet || body.address || "");
  const safe = (body.address && body.address.length === 42 ? await resolveSafe(owner).then((s) => s ?? getAddress(body.address!)) : await resolveSafe(owner));
  if (!safe) throw new AppError("NOT_READY", { message: "Create Beacon Safe first." });
  const amountWei = body.amountUsdt0 ? parse0g(body.amountUsdt0) : 0n;
  let data = "0x";
  if (body.action === "deposit") data = VAULT_ABI.encodeFunctionData("deposit");
  if (body.action === "withdraw") data = VAULT_ABI.encodeFunctionData("withdraw", [amountWei]);
  if (body.action === "setPaused") data = VAULT_ABI.encodeFunctionData("setPaused", [Boolean(body.paused)]);
  if (body.action === "setExecutor") {
    data = VAULT_ABI.encodeFunctionData("setExecutor", [body.revoke ? "0x0000000000000000000000000000000000000000" : getAddress(body.executor || "")]);
  }
  if (body.action === "setPolicy") {
    data = VAULT_ABI.encodeFunctionData("setPolicy", [
      body.maxSpendPerTxUsdt0 ? parse0g(body.maxSpendPerTxUsdt0) : 0n,
      body.rollingWindowBudgetUsdt0 ? parse0g(body.rollingWindowBudgetUsdt0) : 0n,
      BigInt(body.rollingWindowSeconds ?? 86400),
      BigInt(body.sessionExpiresAt ?? 0),
    ]);
  }
  return {
    ok: true,
    prep: {
      action: body.action,
      chainId: env.CHAIN_ID,
      network: env.NETWORK_NAME,
      to: safe,
      data,
      amount: amountWei.toString(),
      value: "0",
      ownerOnly: body.action !== "deposit",
      note: body.action === "deposit" ? "Send native 0G into Beacon Safe." : "Owner-signed vault call.",
      honesty: "This is a prepared calldata. The wallet submits it.",
    },
  };
});

async function runSafeZiaSwap(input: {
  wallet: string;
  amountInUnits: string;
  tokenIn?: string;
  tokenOut?: string;
  slippageBps?: number;
}) {
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const owner = getAddress(input.wallet);
  const safe = await resolveSafe(owner);
  if (!safe) throw new AppError("NOT_READY", { message: "Create Beacon Safe first." });
  const tokenIn = input.tokenIn ?? "0G";
  const tokenOut = input.tokenOut ?? "USDC";
  const inTok = resolveZiaToken(tokenIn);
  const amountIn = parseTokenAmount(input.amountInUnits, inTok?.docsDecimals ?? 18);
  const quote = await quoteZiaPair({
    amountIn,
    tokenIn,
    tokenOut,
    slippageBps: input.slippageBps ?? 100,
  });
  if (!quote.executableFromSafe) {
    throw new AppError("SWAP_REFUSED", {
      message: quote.executeBlock || "Beacon Safe cannot execute this direction.",
    });
  }
  if (quote.router.toLowerCase() !== env.ZIA_ROUTER.toLowerCase()) {
    throw new AppError("SWAP_REFUSED", { message: "Quote router is not the allowlisted Zia router." });
  }
  const built = buildSwapTx(quote, safe, { nonce: 0n, wrapNative: quote.wrapNative });
  const hashes: string[] = [];
  let nonce = BigInt(Date.now());
  for (const call of built.calls) {
    if (call.target.toLowerCase() !== env.ZEROG_W0G.toLowerCase() && call.target.toLowerCase() !== env.ZIA_ROUTER.toLowerCase()) {
      throw new AppError("SWAP_REFUSED", { message: "Beacon refused this swap. Only W0G wrap/approve and Zia exactInputSingle are permitted." });
    }
    const tx = await sendSettlerTx({
      to: safe,
      data: VAULT_ABI.encodeFunctionData("execute", [call.target, call.data, call.maxSpend, nonce, call.value]),
    });
    hashes.push(tx.hash);
    await waitSettlerTx(tx);
    nonce += 1n;
  }
  const spendHash = hashes[0] ?? "";
  const fulfillHash = hashes[hashes.length - 1] ?? spendHash;
  return {
    ok: true as const,
    spendHash,
    fulfillHash,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    tokenIn: quote.tokenInSymbol,
    tokenOut: quote.tokenOutSymbol,
    recipient: safe,
    explorerSpend: explorerTx(spendHash),
    explorerFulfill: explorerTx(fulfillHash),
    chainId: env.CHAIN_ID,
    honesty: "Executor submitted wrap + approve + Zia exactInputSingle from Beacon Safe. Output token stays in the Safe.",
  };
}

app.post("/v1/vault/safe-swap/execute", async (req) => {
  const body = z
    .object({
      wallet: z.string().min(42),
      amountInUnits: z.string(),
      recipient: z.string().min(42),
      slippageBps: z.number().int().nonnegative().optional(),
      tokenIn: z.string().optional(),
      tokenOut: z.string().optional(),
    })
    .parse(req.body);
  requireWalletSession(req, body.wallet);
  return runSafeZiaSwap(body);
});

app.get("/v1/security/policy", async (req) => {
  const walletRaw = String((req.query as { wallet?: string }).wallet ?? "");
  const key = walletRaw ? getAddress(walletRaw).toLowerCase() : "";
  const policy = (key && appPolicies.get(key)) || DEFAULT_APP_POLICY;
  return {
    ok: true,
    policy,
    source: key && appPolicies.has(key) ? "saved" : "default",
    receipt: {
      title: "App limits",
      spentTodayUsdt0: 0,
      remainingUsdt0: policy.dailySpendUsdt0,
      dailyBudgetUsdt0: policy.dailySpendUsdt0,
      perJobLimitUsdt0: policy.perJobLimitUsdt0,
      emergencyPause: policy.emergencyPause,
      allowedAgents: policy.allowedAgents,
      note: "App limits sit in front of on-chain Safe caps. Unit is native 0G.",
    },
  };
});

app.put("/v1/security/policy", async (req) => {
  const body = z
    .object({
      wallet: z.string().min(42),
      policy: z.object({
        dailySpendUsdt0: z.number(),
        perJobLimitUsdt0: z.number(),
        allowedAgents: z.array(z.string()),
        allowedChains: z.array(z.number()),
        maxImageCostUsdt0: z.number(),
        maxVideoSeconds: z.number(),
        emergencyPause: z.boolean(),
        sessionExpiryHours: z.number(),
      }),
    })
    .parse(req.body);
  requireWalletSession(req, body.wallet);
  const key = getAddress(body.wallet).toLowerCase();
  appPolicies.set(key, { ...body.policy, allowedChains: body.policy.allowedChains.filter((c) => c === CHAIN_ID) });
  return { ok: true, policy: appPolicies.get(key), source: "saved" };
});

app.post("/v1/security/revoke", async (req) => {
  const body = z.object({ wallet: z.string().min(42) }).parse(req.body);
  requireWalletSession(req, body.wallet);
  appPolicies.delete(getAddress(body.wallet).toLowerCase());
  return { ok: true, message: "App limits reset. Sign again to unlock Beacon Agent." };
});

async function vaultSnapshotForMcp(safe: string) {
  const [wealth] = await vaultView(safe, "wealth");
  const [paused] = await vaultView(safe, "paused");
  const [maxSpend] = await vaultView(safe, "maxSpendPerTx");
  const [windowSpent] = await vaultView(safe, "windowSpent");
  const [windowBudget] = await vaultView(safe, "rollingWindowBudget");
  return {
    wealth: format0g(wealth).replace(/ 0G$/, ""),
    paused: Boolean(paused),
    maxSpendPerTx: format0g(maxSpend).replace(/ 0G$/, ""),
    windowSpent: format0g(windowSpent).replace(/ 0G$/, ""),
    windowBudget: format0g(windowBudget).replace(/ 0G$/, ""),
    windowSpent0g: Number(windowSpent.toString()) / 1e18,
  };
}

registerMcpRoutes(app, {
  env,
  redis: jobRedis,
  requireWalletSession,
  bearerToken,
  resolveSafe,
  vaultSnapshot: vaultSnapshotForMcp,
  getJob,
  createQuotedJob: async (input) =>
    createQuotedJob({
      wallet: input.wallet,
      task: input.task,
      brief: input.brief,
      serviceId: input.serviceId,
    }),
  executeSafeSwap: (input) => runSafeZiaSwap(input),
});

app.get("/v1/erc8004/status", async () => {
  const status = await probeErc8004(provider, {
    identity: env.ERC8004_IDENTITY,
    reputation: env.ERC8004_REPUTATION,
  });
  return { ok: true, ...status };
});

app.post("/v1/erc8004/feedback", async (req) => {
  const body = z
    .object({
      wallet: z.string().min(42),
      agentId: z.string().default("3531902"),
      uri: z.string().url().optional(),
    })
    .parse(req.body);
  requireWalletSession(req, body.wallet);
  if (!settler) throw new AppError("NOT_READY", { message: "Settler key is not configured." });
  const status = await probeErc8004(provider, {
    identity: env.ERC8004_IDENTITY,
    reputation: env.ERC8004_REPUTATION,
  });
  if (status.giveFeedback !== "REAL" || !status.workingSelector) {
    throw new AppError("NO_FIT", {
      message: status.honesty,
    });
  }
  const encoded = encodeGiveFeedback(status.workingSelector);
  if (!encoded) {
    throw new AppError("NO_FIT", { message: "giveFeedback encoder is not available for the live selector." });
  }
  const data = encoded.toData(BigInt(body.agentId), body.uri ?? "https://beacon-0g.vercel.app");
  const tx = await sendSettlerTx({ to: status.reputation, data });
  await waitSettlerTx(tx);
  return {
    ok: true,
    tx: tx.hash,
    explorer: explorerTx(tx.hash),
    selector: status.workingSelector,
    honesty: "Submitted giveFeedback on Aristotle. Explorer is the source of truth.",
  };
});

app.get("/v1/agents/bridge/routes", async () => ({
  ok: true,
  executableFromBeaconSafe: false,
  source: "zia-docs+get.0g.ai+hub",
  routes: BRIDGE_CATALOG,
}));
app.get("/v1/agents/bridge/delivery", async () => {
  throw new AppError("NO_FIT", {
    message:
      "Beacon does not mark a bridge complete from a source-chain tx. Track Hub/Stargate/Interport on their own explorers, then confirm the 0G balance.",
  });
});
app.post("/v1/agents/bridge/execute", async () => {
  throw new AppError("NO_FIT", {
    message:
      "Beacon Safe cannot execute a bridge. Sign on the source chain at hub.0g.ai/bridge or the venue in /v1/bridge/catalog.",
  });
});

app.post("/v1/swap/quote", async (req) => {
  const body = z
    .object({
      amount0g: z.string().optional(),
      amount: z.string().optional(),
      tokenIn: z.string().optional(),
      tokenOut: z.string().optional(),
    })
    .parse(req.body);
  const tokenIn = body.tokenIn ?? "0G";
  const tokenOut = body.tokenOut ?? "USDC";
  const inTok = resolveZiaToken(tokenIn);
  const amount = body.amount ?? body.amount0g;
  if (!amount) throw new AppError("VALIDATION", { message: "amount is required." });
  const quote = await quoteZiaPair({
    amountIn: parseTokenAmount(amount, inTok?.docsDecimals ?? 18),
    tokenIn,
    tokenOut,
  });
  return {
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minOut: quote.minOut.toString(),
    impactBps: quote.impactBps,
    fee: quote.fee,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    tokenInSymbol: quote.tokenInSymbol,
    tokenOutSymbol: quote.tokenOutSymbol,
    wrapNative: quote.wrapNative,
    executableFromSafe: quote.executableFromSafe,
    executeBlock: quote.executeBlock,
    router: quote.router,
    path: quote.path,
  };
});

app.post("/v1/swap/build", async (req) => {
  const body = z
    .object({
      amount0g: z.string(),
      vault: z.string(),
      nonce: z.number().int().nonnegative(),
    })
    .parse(req.body);
  const quote = await quoteExactIn(parse0g(body.amount0g));
  const built = buildSwapTx(quote, getAddress(body.vault), {
    nonce: BigInt(body.nonce),
  });
  return built;
});

app.post("/v1/flow/chat", async (req) => {
  const body = z
    .object({
      text: z.string().min(1).max(8000),
      wallet: z.string().optional(),
    })
    .parse(req.body);
  const text = body.text.toLowerCase();
  const classified = classifyFlowIntent(body.text);
  if (classified.kind === "deny_unconstrained" || (/5\s*0g|send .*0g to 0x/.test(text) && /random|this address|0x/.test(text))) {
    return {
      reply: "Blocked before funds moved.",
      denial: {
        hard: "Destination is not allowlisted and the amount exceeds MAX_TX.",
        semantic: "The request is an unconstrained transfer, not a Beacon job.",
      },
      cards: [
        {
          type: "denied",
          title: "Why was I blocked?",
          hard: "Destination is not allowlisted and the amount exceeds MAX_TX.",
          semantic: "The request is an unconstrained transfer, not a Beacon job.",
          requested: "5 0G",
          fundsMoved: "0 0G",
        },
      ],
    };
  }
  if (classified.kind === "why_blocked") {
    const last = await lastJobForWallet(body.wallet);
    if (last?.denial) {
      return {
        reply: `DENIED. ${last.denial} Funds moved: ${last.refundTx ? "refunded" : last.lockTx ? "escrow locked then settled" : "0 0G"}.`,
        cards: [
          {
            type: "denied",
            title: "Why was I blocked?",
            hard: last.denial,
            semantic: last.tee?.reason ?? last.denial,
            requested: format0g(last.quote.lock0g),
            fundsMoved: last.refundTx ? "refunded" : "0 0G",
            proofHref: `/verify/${last.id}`,
          },
        ],
      };
    }
    return {
      reply:
        "Hard policy blocks unconstrained sends before funds move. TeeML can also DENY a vault action. Ask after a blocked swap or job for the exact cap vs requested amount.",
      cards: [{ type: "denied", title: "Why blocked", hard: "Allowlisted targets + MAX_TX.", semantic: "No last denial on file." }],
    };
  }
  if (classified.kind === "balance") {
    if (!body.wallet) {
      return { reply: "Connect a wallet to read Beacon Safe wealth on Aristotle.", cards: [] };
    }
    const safe = await resolveSafe(getAddress(body.wallet));
    if (!safe) {
      return { reply: "No Beacon Safe for this wallet yet. Open Safe to create one.", cards: [{ type: "desk_link", title: "Open Safe", href: "/flow/security", summary: "Create or fund Beacon Safe." }] };
    }
    const [wealth] = await vaultView(safe, "wealth");
    const [windowSpent] = await vaultView(safe, "windowSpent");
    const [windowBudget] = await vaultView(safe, "rollingWindowBudget");
    return {
      reply: `Beacon Safe ${safe.slice(0, 6)}… wealth ${format0g(wealth)}. Policy window ${format0g(windowSpent)} / ${format0g(windowBudget)}. This is not job escrow.`,
      cards: [
        {
          type: "quote",
          unit: "0G",
          title: "Safe wealth",
          summary: `${format0g(wealth)} · window ${format0g(windowSpent)} / ${format0g(windowBudget)}`,
        },
      ],
    };
  }
  if (/verify/.test(text) && /last|proof|receipt|result/.test(text)) {
    const last = await lastJobForWallet(body.wallet);
    if (!last) {
      return {
        reply: "No job is on file for this wallet yet. Run an image or research job first.",
        cards: [],
      };
    }
    const onchainish = Boolean(last.releaseTx || last.refundTx);
    return {
      reply: onchainish
        ? `Job ${last.id.slice(0, 8)}… is ${last.status}. Open the proof — the registry is authoritative.`
        : `Job ${last.id.slice(0, 8)}… is ${last.status}. Proof updates when lock/release land on Aristotle.`,
      cards: [
        {
          type: "desk_link",
          title: "View proof",
          summary: `${last.quote.modelId} · ${last.status}`,
          href: `/verify/${last.id}`,
        },
        {
          type: "desk_link",
          title: "Open desk",
          summary: "Result, image, and escrow txs.",
          href: `/flow/desk?job=${last.id}`,
        },
      ],
    };
  }
  if (/what can (beacon|you) do|capabilities|what can i do/.test(text)) {
    return {
      reply:
        "Beacon only exposes tools that are live: inspect, jobs, Zia swaps with a factory pool, documented bridges (not Safe-executable), policy, and proof.",
      cards: [capabilityCard()],
    };
  }
  if (/what can i swap|swap assets|what assets can i swap|what tokens can i swap/.test(text)) {
    const listed = await listSwapAssets({ env });
    const live = listed.routes.filter((r) => r.from.symbol === "0G");
    return {
      reply: live.length
        ? `Live Zia routes (factory pool + quoter amountOut > 0): ${live.map((r) => `0G → ${r.to.symbol} @ ${r.fee}`).join("; ")}.`
        : "Beacon cannot verify a viable Zia route for this pair.",
      cards: [
        {
          type: "swap_assets",
          title: "Zia swap assets",
          summary: listed.source,
          routes: live,
          asOf: listed.asOf,
        },
      ],
    };
  }
  if (classified.kind === "bridge_quote" || (/\bbridge\b/.test(text) && parseBridgeIntent(body.text))) {
    const intent = parseBridgeIntent(body.text);
    if (!intent) {
      return {
        reply:
          "Name a source chain and amount. Example: Bridge 1 USDC from Base to 0G. Beacon Safe cannot sign Base.",
        cards: [bridgeCatalogCard()],
      };
    }
    if (!body.wallet) {
      return {
        reply: "Connect the wallet that will sign on the source chain. Beacon Safe cannot execute this.",
        cards: [bridgeCatalogCard()],
      };
    }
    try {
      const card = await quoteLifiBridge(intent, getAddress(body.wallet));
      return {
        reply: `${card.title}. ~${card.estimatedOut} ${card.assetOut} on Aristotle in ~${card.etaSeconds}s. ${card.requiredSignatures[0]}`,
        cards: [card, bridgeCatalogCard()],
      };
    } catch (err) {
      return {
        reply: isAppError(err)
          ? err.userMessage
          : "LI.FI could not quote this route. Beacon will not invent a bridge.",
        cards: [bridgeCatalogCard()],
      };
    }
  }
  if (/\bbridge\b/.test(text)) {
    return {
      reply:
        "Beacon cannot execute a bridge from the Aristotle Safe. Official path: XSwap/CCIP or LI.FI (zerog). Sign on the source chain. Example: Bridge 1 USDC from Base to 0G.",
      cards: [bridgeCatalogCard()],
    };
  }
  if (/erc-?8004|givefeedback|agent (identity|reputation|feedback)/.test(text)) {
    const status = await probeErc8004(provider, {
      identity: env.ERC8004_IDENTITY,
      reputation: env.ERC8004_REPUTATION,
    });
    return {
      reply: `ERC-8004 Identity ${status.identityCodeBytes} bytes. Reputation ${status.reputationCodeBytes} bytes. giveFeedback is ${status.giveFeedback}. ${status.honesty}`,
      cards: [
        {
          type: "inspect_result",
          title: "ERC-8004",
          inspect: {
            address: status.reputation,
            explorer: status.explorerReputation,
            isContract: status.reputationCodeBytes > 0,
            bytecodeBytes: status.reputationCodeBytes,
            verifiedNote: status.honesty,
            risks: status.candidates.filter((c) => c.inBytecode).map((c) => c.name),
          },
        },
      ],
    };
  }
  const txHash = body.text.match(/0x[a-fA-F0-9]{64}/)?.[0];
  const inspectAddr = body.text.match(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/)?.[0];
  if (/analyze this wallet|inspect my (wallet|safe)|analyze my (wallet|safe)/.test(text) && !inspectAddr && !txHash) {
    if (!body.wallet) {
      return {
        reply: "Connect a wallet so Beacon can inspect it on Aristotle. Beacon will not invent an address.",
        cards: [],
      };
    }
  }
  const addressTarget =
    inspectAddr ||
    (/analyze this wallet|inspect my (wallet|safe)|analyze my (wallet|safe)|inspect this wallet/.test(text) && body.wallet
      ? body.wallet
      : undefined);
  if (txHash && /inspect|analyze|explain|transaction|\btx\b/.test(text)) {
    const info = await inspectTransaction(provider, txHash);
    const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
    const brief = `Explain this Aristotle transaction from evidence only.\n${JSON.stringify(info)}`;
    const quote = quoteJob(catalog, { task: "cheap", briefText: brief });
    quotes.set(quote.quoteId, quote);
    const job = await createQuotedJob({
      wallet: body.wallet,
      task: "cheap",
      brief,
      quoteId: quote.quoteId,
      serviceId: "analysis",
    });
    return {
      reply: `Transaction ${info.status} on Aristotle. Evidence is from live RPC. Paid interpretation is a cheap TeeML job — lock ${format0g(quote.lock0g)}.`,
      cards: [
        { type: "inspect_result", title: "Transaction", inspect: info },
        { type: "quote", unit: "0G", title: "Explain this tx", summary: `${quote.modelId} · ${format0g(quote.lock0g)}` },
        ...jobStayCards(job, "Start analysis", "Runs in Flow. Jobs page keeps the full progress history."),
      ],
    };
  }
  if (addressTarget && /inspect|analyze|explain|contract|wallet|address/.test(text)) {
    const info = await inspectAddress(provider, addressTarget);
    const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
    const brief = `Explain this Aristotle ${info.isContract ? "contract" : "wallet"} from evidence only. Do not invent ABI.\n${JSON.stringify(info)}`;
    const quote = quoteJob(catalog, { task: "cheap", briefText: brief });
    quotes.set(quote.quoteId, quote);
    const job = await createQuotedJob({
      wallet: body.wallet,
      task: "cheap",
      brief,
      quoteId: quote.quoteId,
      serviceId: "analysis",
    });
    return {
      reply: info.isContract
        ? `Contract ${info.address}. ${info.bytecodeBytes} bytecode bytes. Source is not verified in Beacon. ${info.risks[0] ?? ""} Paid explanation locks ${format0g(quote.lock0g)}.`
        : `Wallet ${info.address}. Native 0G from live RPC. Paid explanation locks ${format0g(quote.lock0g)}. Beacon does not claim complete token history.`,
      cards: [
        { type: "inspect_result", title: info.isContract ? "Contract" : "Wallet", inspect: info },
        { type: "quote", unit: "0G", title: "Explain this address", summary: `${quote.modelId} · ${format0g(quote.lock0g)}` },
        ...jobStayCards(job, "Start analysis", "Deep TeeML explanation. Stay in Flow; desk is optional."),
      ],
    };
  }
  if (
    classified.kind === "spend" ||
    /what did i spend|show what the last job cost|spend(ing)? summary|cost today|how much did i spend/.test(text)
  ) {
    const last = await lastJobForWallet(body.wallet);
    const ids = jobRedis && body.wallet ? await listWalletJobIds(jobRedis, body.wallet) : [];
    const rows = [];
    for (const id of ids.slice(0, 8)) {
      const job = await getJob(id);
      if (!job) continue;
      rows.push({
        id: job.id,
        status: job.status,
        task: job.task,
        lock0g: format0g(job.quote.lock0g),
        modelId: job.quote.modelId,
      });
    }
    const imageOnly = /image/.test(text);
    const swapAsk = /swap/.test(text);
    const filtered = imageOnly ? rows.filter((r) => r.task === "image") : rows;
    if (!last && filtered.length === 0) {
      return {
        reply: swapAsk
          ? "Zia swaps debit Beacon Safe wealth (windowSpent). They are not job escrow. Do not add the two."
          : "No Beacon jobs are on file for this wallet yet.",
        cards: [],
      };
    }
    const shown = last ?? (await getJob(filtered[0]?.id ?? ""));
    const cards: Array<Record<string, unknown>> = [
      {
        type: "quote",
        unit: "0G",
        title: imageOnly ? "Image job escrow" : "Job spend (escrow)",
        summary:
          filtered.map((r) => `${r.id.slice(0, 8)} ${r.status} ${r.lock0g}`).join(" · ") ||
          `${shown?.status ?? ""} · ${shown ? format0g(shown.quote.lock0g) : ""}`,
      },
    ];
    if (shown) {
      cards.push({
        type: "desk_link",
        title: "View proof",
        summary: shown.status,
        href: `/verify/${shown.id}`,
      });
    }
    return {
      reply: shown
        ? `${swapAsk ? "Swaps are Safe windowSpent, not this list. " : ""}Job records (escrow), not a chain archive. Last ${shown.id.slice(0, 8)}… ${shown.status} locked ${format0g(shown.quote.lock0g)}. Safe windowSpent is a different number — do not add them.`
        : "No Beacon jobs are on file for this wallet yet.",
      cards,
    };
  }
  const swapIntent = parseSwapIntent(body.text);
  if (swapIntent || /swap|convert|usdc|wbtc|st0g/.test(text)) {
    try {
      const intent =
        swapIntent ??
        ({
          amount: text.match(/([\d.]+)\s*0g/)?.[1] ?? "0.2",
          tokenIn: resolveZiaToken("0G")!,
          tokenOut: resolveZiaToken("USDC")!,
        } as const);
      const quote = await quoteZiaPair({
        amountIn: parseTokenAmount(intent.amount, intent.tokenIn.docsDecimals ?? 18),
        tokenIn: intent.tokenIn.symbol,
        tokenOut: intent.tokenOut.native ? "0G" : intent.tokenOut.symbol,
        slippageBps: 100,
      });
      const outTok = resolveZiaToken(quote.tokenOut);
      const outDecimals = outTok?.docsDecimals ?? (quote.tokenOutSymbol === "0G" ? 18 : 6);
      const estimatedOut = formatTokenAmount(quote.amountOut, outDecimals);
      const minReceived = formatTokenAmount(quote.minOut, outDecimals);
      let pool: string | null = null;
      try {
        const hit = await findPoolFee(
          async (tx) => provider.call({ to: tx.to, data: tx.data }),
          env.ZIA_FACTORY,
          quote.tokenIn,
          quote.tokenOut,
        );
        pool = hit?.pool ?? null;
      } catch {
        pool = null;
      }
      let policyStatus = "Connect a wallet to check Beacon Safe policy.";
      if (body.wallet) {
        const safe = await resolveSafe(getAddress(body.wallet));
        if (!safe) {
          policyStatus = "No Beacon Safe yet. Open Safe before executing.";
        } else {
          const [maxTx] = await vaultView(safe, "maxSpendPerTx");
          const requested = quote.wrapNative ? quote.amountIn : 0n;
          policyStatus =
            quote.executableFromSafe && requested > 0n && requested > (maxTx as bigint)
              ? `Would DENY: ${format0g(requested)} exceeds per-tx cap ${format0g(maxTx as bigint)}.`
              : `Per-tx cap ${format0g(maxTx as bigint)}. ${quote.executableFromSafe ? "Executable from Safe if TeeML ALLOW." : "Quote only — Safe cannot execute this direction."}`;
        }
      }
      const quotedAt = new Date().toISOString();
      return {
        reply: quote.executableFromSafe
          ? `Zia quote for ${intent.amount} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol}. Pool fee ${quote.fee}. Impact ${quote.impactBps} bps. Min ${minReceived} ${quote.tokenOutSymbol}.`
          : `Live quote ${intent.amount} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol}. ${quote.executeBlock}`,
        quote: {
          amountOut: quote.amountOut.toString(),
          minOut: quote.minOut.toString(),
          impactBps: quote.impactBps,
          modelId: "zia-exactInputSingle",
        },
        cards: [
          {
            type: "swap_prepare",
            mode: "beacon_safe",
            requiresMetaMask: false,
            title: "Zia swap",
            amountInDisplay: intent.amount,
            estimatedOut,
            minReceived,
            symbolIn: quote.tokenInSymbol,
            symbolOut: quote.tokenOutSymbol,
            tokenIn: quote.tokenInSymbol,
            tokenOut: quote.tokenOutSymbol,
            executableFromSafe: quote.executableFromSafe,
            executeBlock: quote.executeBlock,
            chainId: env.CHAIN_ID,
            slippageBps: 100,
            fee: quote.fee,
            pool,
            impactBps: quote.impactBps,
            quotedAt,
            policyStatus,
            route: `exactInputSingle ${quote.tokenInSymbol}→${quote.tokenOutSymbol} fee ${quote.fee}`,
            warning: quote.executableFromSafe
              ? "Unlock Beacon Agent if the session is locked. Thin books are refused before funds move."
              : quote.executeBlock,
            honesty: quote.executableFromSafe
              ? "Native 0G → W0G.deposit → approve Zia SwapRouter → exactInputSingle. Output stays in the Safe."
              : quote.executeBlock,
            ogPrimitive: "Zia SwapRouter",
            network: "0G Aristotle",
          },
        ],
      };
    } catch (err) {
      return {
        reply: isAppError(err)
          ? err.userMessage
          : "Beacon cannot verify a viable Zia route for this pair.",
        status: "REFUSED",
        cards: [
          {
            type: "denied",
            title: "Swap refused",
            reason: isAppError(err) ? err.userMessage : "Beacon cannot verify a viable Zia route for this pair.",
          },
        ],
      };
    }
  }
  if (/cheap(er|est)?/.test(text)) {
    const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
    const last = await lastJobForWallet(body.wallet);
    const quote = quoteJob(catalog, { task: "cheap", briefText: body.text });
    quotes.set(quote.quoteId, quote);
    const image = quoteJob(catalog, { task: "image", briefText: "x", imageCount: 1 });
    const lastLine = last
      ? `Last job ${last.quote.modelId} locked ${format0g(last.quote.lock0g)} (${last.task}).`
      : "No previous job on file.";
    const cheaperThanLast =
      last && last.task !== "image" && quote.lock0g < last.quote.lock0g
        ? `This lock is lower than the last chat job.`
        : last?.task === "image"
          ? `Image stays on ${image.modelId} at ${format0g(image.lock0g)}; cheaper applies to chat/research.`
          : `Live cheapest verified chat: ${quote.modelId}.`;
    const job = await createQuotedJob({
      wallet: body.wallet,
      task: "cheap",
      brief: body.text,
      quoteId: quote.quoteId,
      serviceId: "research",
    });
    return {
      reply: `${cheaperThanLast} ${lastLine} Compute ${format0g(quote.modelCost0g)} · Storage ${format0g(quote.storage0g)} · Beacon fee ${format0g(quote.service0g)} · Total ${format0g(quote.lock0g)}.`,
      quote: serializeQuote(quote),
      cards: [
        {
          type: "quote",
          unit: "0G",
          title: "Cheap catalog quote",
          summary: `${quote.modelId} · ${quote.verifiability} · ${format0g(quote.lock0g)}`,
        },
        ...jobStayCards(job, "Start cheaper job", "Escrow native 0G then run Compute. Stay in this chat."),
      ],
    };
  }
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const task: ModelTask = /image|lighthouse|picture|draw/.test(text) ? "image" : "cheap";
  const quote = quoteJob(catalog, { task, briefText: body.text, imageCount: task === "image" ? 1 : 0 });
  quotes.set(quote.quoteId, quote);
  const job = await createQuotedJob({
    wallet: body.wallet,
    task,
    brief: body.text,
    quoteId: quote.quoteId,
    serviceId: task === "image" ? "image" : "research",
  });
  return {
    reply: `Quote in 0G. Model ${quote.modelId}. Approve to lock ${format0g(quote.lock0g)}.`,
    quote: serializeQuote(quote),
    cards: [
      { type: "quote", unit: "0G", title: "Quote in native 0G", summary: `${quote.modelId} · compute ${format0g(quote.modelCost0g)} · storage ${format0g(quote.storage0g)} · fee ${format0g(quote.service0g)} · total ${format0g(quote.lock0g)}` },
      ...jobStayCards(
        job,
        task === "image" ? "Start image job" : "Start research job",
        "Runs in the background. You can keep chatting.",
      ),
    ],
  };
});

const teeStatus = async () => ({
  ok: true,
  mode: "verified" as const,
  simulatedTee: false,
  honesty: "0G TeeML fail-closed. Independent processResponse + EIP-191. Router verify_tee is not sufficient.",
  proxyReachable: Boolean(env.COMPUTE_API_KEY),
  localMode: false,
});
app.get("/v1/tee/status", teeStatus);
app.get("/v1/fcc/status", teeStatus);

app.get("/v1/agents", async () => ({
  network: env.NETWORK_NAME,
  chainId: env.CHAIN_ID,
  agents: [
    {
      id: "general",
      name: "Beacon",
      blurb: "Quote in 0G, policy + TeeML, then lock or deny.",
      builtIn: true,
      x402PriceUsdt0: 0,
      mention: "@beacon",
    },
  ],
  rails: { compute: env.ZEROG_ROUTER_URL, explorer: env.ZEROG_EXPLORER, zia: env.ZIA_ROUTER },
}));

app.get("/v1/agents/balances", async (req) => {
  const walletRaw = String((req.query as { wallet?: string }).wallet ?? "");
  let formatted = "0";
  let usdcFormatted = "0";
  if (walletRaw && env.BEACON_VAULT_FACTORY) {
    const wallet = getAddress(walletRaw);
    const raw = await provider.call({
      to: env.BEACON_VAULT_FACTORY,
      data: FACTORY_ABI.encodeFunctionData("safeOf", [wallet]),
    });
    const [safe] = FACTORY_ABI.decodeFunctionResult("safeOf", raw);
    if (safe !== "0x0000000000000000000000000000000000000000") {
      const wealthRaw = await provider.call({ to: safe, data: VAULT_ABI.encodeFunctionData("wealth") });
      const [wealth] = VAULT_ABI.decodeFunctionResult("wealth", wealthRaw);
      formatted = format0g(wealth).replace(/ 0G$/, "");
      if (env.ZEROG_USDCE) {
        const usdcRaw = await provider.call({
          to: env.ZEROG_USDCE,
          data: ERC20_ABI.encodeFunctionData("balanceOf", [safe]),
        });
        const [usdc] = ERC20_ABI.decodeFunctionResult("balanceOf", usdcRaw);
        usdcFormatted = (Number(usdc) / 1e6).toString();
      }
    }
  }
  return {
    ok: true,
    wallet: walletRaw,
    balances: {
      usdt0: { address: "native", formatted, symbol: "0G" },
      fxrp: { address: env.ZEROG_USDCE, formatted: usdcFormatted, symbol: "USDC.e" },
      mockUsdt0: null,
    },
  };
});

function parseCards(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return raw ?? [];
}

function requireHistory() {
  if (!history || !historyReady) throw new AppError("HISTORY_PERSISTENCE_FAILED");
  return history;
}

app.get("/v1/flow/spend", async (req) => {
  const wallet = String((req.query as { wallet?: string }).wallet ?? "");
  if (!wallet) return { ok: true, jobs: [], vault: null, honesty: "Connect a wallet." };
  const owner = getAddress(wallet);
  const ids = jobRedis ? await listWalletJobIds(jobRedis, owner) : [];
  const memIds = [...jobs.values()]
    .filter((j) => {
      try {
        return j.wallet && getAddress(j.wallet) === owner;
      } catch {
        return false;
      }
    })
    .map((j) => j.id);
  const all = [...new Set([...ids, ...memIds])];
  const jobRows = [];
  for (const id of all.slice(0, 20)) {
    const job = await getJob(id);
    if (!job) continue;
    jobRows.push({
      id: job.id,
      status: job.status,
      lock0g: format0g(job.quote.lock0g),
      modelId: job.quote.modelId,
      lockTx: job.lockTx ?? null,
      releaseTx: job.releaseTx ?? null,
      refundTx: job.refundTx ?? null,
    });
  }
  const safe = await resolveSafe(owner);
  let vault: { address: string; windowSpent: string; windowBudget: string } | null = null;
  if (safe) {
    const [windowSpent] = await vaultView(safe, "windowSpent");
    const [windowBudget] = await vaultView(safe, "rollingWindowBudget");
    vault = {
      address: safe,
      windowSpent: format0g(windowSpent),
      windowBudget: format0g(windowBudget),
    };
  }
  return {
    ok: true,
    jobs: jobRows,
    vault,
    honesty:
      "Job lock/release is escrow. windowSpent is the Safe rolling window. Do not add them together.",
  };
});

app.get("/v1/flow/conversations", async (req) => {
  const wallet = String((req.query as { wallet?: string }).wallet ?? "");
  if (!wallet) return { ok: true, conversations: [] };
  const store = requireHistory();
  const conversations = await store.listConversations(getAddress(wallet));
  return {
    ok: true,
    conversations: conversations.map((c) => {
      const meta = historyMeta({
        title: String((c as { title?: string }).title ?? ""),
        lastMessage: (c as { last_message?: string | null }).last_message,
        cards: parseCards((c as { last_cards?: unknown }).last_cards),
      });
      return {
        ...c,
        job_ids: meta.jobIds,
        capability: meta.capability,
        status: meta.status,
      };
    }),
  };
});

app.post("/v1/flow/conversations", async (req) => {
  const body = z
    .object({ wallet: z.string(), title: z.string().optional(), agentId: z.string().optional() })
    .parse(req.body);
  const store = requireHistory();
  const conversation = await store.createConversation(
    getAddress(body.wallet),
    body.title || "New chat",
    body.agentId || "general",
  );
  return { ok: true, conversation };
});

app.get("/v1/flow/conversations/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const wallet = String((req.query as { wallet?: string }).wallet ?? "");
  if (!wallet) throw new AppError("HISTORY_PERSISTENCE_FAILED", { message: "Connect a wallet to load chat history." });
  const store = requireHistory();
  const conversation = await store.getConversation(id, getAddress(wallet));
  if (!conversation) throw new AppError("JOB_NOT_FOUND", { message: "Conversation not found." });
  const rows = await store.listMessages(id);
  return {
    ok: true,
    conversation,
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      agentId: m.agent_id,
      text: m.text,
      cards: m.cards_json,
      displayModel: m.display_model,
    })),
  };
});

app.patch("/v1/flow/conversations/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const body = z
    .object({
      wallet: z.string(),
      title: z.string().optional(),
      pinned: z.boolean().optional(),
      archive: z.boolean().optional(),
    })
    .parse(req.body);
  const store = requireHistory();
  const wallet = getAddress(body.wallet);
  if (body.archive) await store.archiveConversation(id, wallet);
  else if (body.title) await store.renameConversation(id, wallet, body.title);
  else if (body.pinned !== undefined) await store.pinConversation(id, wallet, body.pinned);
  return { ok: true };
});

app.get("/v1/flow/activity", async (req) => {
  const wallet = String((req.query as { wallet?: string }).wallet ?? "");
  if (!wallet || !history) return { ok: true, activity: [] };
  const activity = await history.listActivity(getAddress(wallet));
  return { ok: true, activity };
});

app.post("/v1/flow/activity", async (req) => {
  const body = z
    .object({
      wallet: z.string(),
      kind: z.string(),
      title: z.string(),
      explorerUrl: z.string().optional(),
      refId: z.string().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(req.body);
  const store = requireHistory();
  await store.recordActivity(
    getAddress(body.wallet),
    body.kind,
    body.title,
    body.meta ?? {},
    body.explorerUrl,
    body.refId,
  );
  return { ok: true };
});

app.post("/v1/agents/chat", async (req) => {
  const body = z
    .object({
      agentId: z.string().optional(),
      message: z.string().min(1).max(8000),
      wallet: z.string().optional(),
      conversationId: z.string().optional(),
      state: z
        .object({
          intent: z.string(),
          phase: z.string(),
          amountInUnits: z.string().optional(),
          serviceId: z.string().optional(),
          creativeBrief: z.string().optional(),
          quotePrice: z.string().optional(),
        })
        .nullable()
        .optional(),
    })
    .parse(req.body);
  const forwarded = await app.inject({
    method: "POST",
    url: "/v1/flow/chat",
    payload: { text: body.message, wallet: body.wallet },
  });
  const data = forwarded.json() as {
    reply?: string;
    cards?: Array<Record<string, unknown> & { type: string }>;
    quote?: { modelId?: string };
  };
  const agentId = body.agentId ?? "general";
  const displayModel = data.quote?.modelId ?? "0G Router";
  let conversationId = body.conversationId ?? null;
  if (body.wallet) {
    const store = requireHistory();
    const wallet = getAddress(body.wallet);
    if (!conversationId) {
      const title = body.message.slice(0, 72) || "New chat";
      const created = await store.createConversation(wallet, title, agentId);
      conversationId = String(created.id);
    }
    const persistedId = conversationId;
    await store.appendMessage(persistedId, {
      role: "user",
      agentId,
      text: body.message,
    });
    await store.appendMessage(persistedId, {
      role: "assistant",
      agentId,
      text: data.reply ?? "",
      cards: data.cards,
      displayModel,
    });
    if (body.state) {
      await store.updateConversationState(persistedId, body.state, agentId);
    }
  }
  return {
    ok: true,
    conversationId,
    agentId,
    text: data.reply ?? "",
    cards: data.cards ?? [],
    model: data.quote?.modelId ?? "0g-router",
    displayModel,
    paid: false,
    state: body.state ?? { intent: "chat", phase: "quoted" },
  };
});

app.setErrorHandler((err, _req, reply) => {
  if (isAppError(err)) {
    return reply.status(err.statusCode).send(err.toJSON());
  }
  app.log.error(err);
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
});

const port = Number.parseInt(process.env.PORT || "", 10) || env.API_PORT;
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Beacon 0G API on ${port}`);
