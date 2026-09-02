import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddress } from "ethers";
import { AppError, format0g, isAppError } from "@beacon/shared";
import {
  DEFAULT_CONNECT_SCOPES,
  appendAudit,
  buildCursorMcpConfig,
  buildSetupPrompt,
  buildConnectCard,
  checkRateLimit,
  filterValidScopes,
  gateTool,
  getGrant,
  handleMcpJsonRpc,
  isGrantActive,
  issueMcpAccessToken,
  issueMcpRefreshToken,
  hashToken,
  listAudit,
  listGrantsForWallet,
  newGrantId,
  revokeGrant,
  saveGrant,
  toolsForGrant,
  verifyMcpAccessToken,
  verifyMcpRefreshToken,
  type McpClientKind,
  type McpGrant,
  type RedisLike,
  type JsonRpcRequest,
} from "@beacon/mcp";
import { quoteZiaPair } from "@beacon/swap";
import type { RedisRest } from "./flowRedis.js";
import { redisLikeFromRest } from "./mcpRedis.js";

type JobLite = {
  id: string;
  wallet: string;
  status: string;
  brief: string;
  task: string;
  quote: { modelId: string; lock0g: bigint };
  lockTx?: string;
  releaseTx?: string;
  refundTx?: string;
  storageRoot?: string;
  resultText?: string;
};

export type McpRouteDeps = {
  env: { SESSION_SECRET: string; API_URL: string; APP_URL: string; CHAIN_ID: number };
  redis: RedisRest | null;
  requireWalletSession: (req: { headers: { authorization?: string } }, wallet: string) => unknown;
  bearerToken: (req: { headers: { authorization?: string } }) => string | null;
  resolveSafe: (owner: string) => Promise<string | null>;
  vaultSnapshot: (safe: string) => Promise<{
    wealth: string;
    paused: boolean;
    maxSpendPerTx: string;
    windowSpent: string;
    windowBudget: string;
    windowSpent0g: number;
  }>;
  getJob: (id: string) => Promise<JobLite | undefined>;
  createQuotedJob: (input: {
    wallet?: string;
    task: "cheap" | "image";
    brief: string;
    serviceId?: string;
  }) => Promise<JobLite>;
  lockAndRunJob?: (input: { jobId: string; wallet: string }) => Promise<JobLite>;
  inspectAddress?: (addr: string) => Promise<unknown>;
  inspectTransaction?: (hash: string) => Promise<unknown>;
  quoteBridge?: (text: string, wallet: string) => Promise<unknown>;
  executeSafeSwap?: (input: {
    wallet: string;
    amountInUnits: string;
    tokenIn: string;
    tokenOut: string;
  }) => Promise<{ spendHash: string; fulfillHash: string; amountOut: string; tokenOut: string }>;
};

function requireRedis(redis: RedisRest | null): RedisLike {
  if (!redis) {
    throw new AppError("NOT_READY", {
      message: "MCP grants need Redis. Beacon will not invent an in-memory grant store.",
    });
  }
  return redisLikeFromRest(redis);
}

function toPublic(grant: McpGrant) {
  const active = isGrantActive(grant);
  return {
    id: grant.id,
    wallet: grant.wallet,
    safeAddress: grant.safeAddress,
    clientKind: grant.clientKind,
    clientLabel: grant.clientLabel,
    scopes: grant.scopes,
    maxSpendPerTx0g: grant.maxSpendPerTx0g,
    dailyLimit0g: grant.dailyLimit0g,
    maxSpendPerTxUsdt0: grant.maxSpendPerTx0g,
    dailyLimitUsdt0: grant.dailyLimit0g,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    active: active.ok,
  };
}

async function requireMcpGrant(
  deps: McpRouteDeps,
  req: { headers: { authorization?: string } },
): Promise<{ grant: McpGrant; store: RedisLike }> {
  const token = deps.bearerToken(req);
  if (!token) throw new AppError("UNAUTHORIZED");
  const parsed = verifyMcpAccessToken(token, deps.env.SESSION_SECRET);
  if (!parsed) throw new AppError("UNAUTHORIZED", { message: "MCP access token is invalid or expired." });
  const store = requireRedis(deps.redis);
  const grant = await getGrant(store, parsed.grantId);
  if (!grant) throw new AppError("UNAUTHORIZED", { message: "MCP grant was not found." });
  const active = isGrantActive(grant);
  if (!active.ok) throw new AppError("UNAUTHORIZED", { message: active.reason });
  if (grant.wallet.toLowerCase() !== parsed.wallet.toLowerCase()) {
    throw new AppError("UNAUTHORIZED");
  }
  return { grant, store };
}

export function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps) {
  const mcpEndpoint = `${deps.env.API_URL.replace(/\/$/, "")}/mcp`;

  app.get("/v1/mcp/health", async () => ({
    ok: true,
    service: "beacon-0g",
    redis: Boolean(deps.redis),
    endpoint: deps.redis ? mcpEndpoint : "",
    connectPage: "/flow/mcp",
    chainId: deps.env.CHAIN_ID,
    authorization: "Bearer MCP access token",
  }));

  app.get("/mcp", async () => ({
    ok: true,
    name: "beacon-mcp",
    version: "0.2.0",
    chainId: deps.env.CHAIN_ID,
    transport: "http jsonrpc",
    endpoint: mcpEndpoint,
    authorization: "Bearer",
    connectPage: "/flow/mcp",
    honesty: "POST /mcp with Authorization: Bearer <access>. The agent never receives a private key.",
  }));

  app.get("/v1/mcp/grants", async (req) => {
    const wallet = String((req.query as { wallet?: string }).wallet ?? "");
    if (!wallet) return { ok: true, grants: [] };
    deps.requireWalletSession(req, wallet);
    const store = requireRedis(deps.redis);
    const grants = await listGrantsForWallet(store, getAddress(wallet));
    return { ok: true, grants: grants.map(toPublic) };
  });

  app.post("/v1/mcp/grants", async (req) => {
    const body = z
      .object({
        wallet: z.string().min(42),
        clientKind: z.enum(["claude", "cursor", "generic"]),
        clientLabel: z.string().max(80).optional(),
    scopes: z.array(z.string()).optional(),
        maxSpendPerTx0g: z.number().nonnegative().optional(),
        dailyLimit0g: z.number().nonnegative().optional(),
        maxSpendPerTxUsdt0: z.number().nonnegative().optional(),
        dailyLimitUsdt0: z.number().nonnegative().optional(),
        ttlHours: z.number().positive().max(24 * 30).optional(),
      })
      .parse(req.body);
    deps.requireWalletSession(req, body.wallet);
    const store = requireRedis(deps.redis);
    const owner = getAddress(body.wallet);
    const safe = await deps.resolveSafe(owner);
    const scopes = filterValidScopes(body.scopes) ;
    const grant: McpGrant = {
      id: newGrantId(),
      wallet: owner,
      safeAddress: safe,
      clientKind: body.clientKind as McpClientKind,
      clientLabel: body.clientLabel || body.clientKind,
      scopes: scopes.length ? scopes : [...DEFAULT_CONNECT_SCOPES],
      maxSpendPerTx0g: Math.min(body.maxSpendPerTx0g ?? body.maxSpendPerTxUsdt0 ?? 5, 5),
      dailyLimit0g: Math.min(body.dailyLimit0g ?? body.dailyLimitUsdt0 ?? 20, 20),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (body.ttlHours ?? 24 * 7) * 3600 * 1000).toISOString(),
      revokedAt: null,
      refreshTokenHash: null,
    };
    const access = issueMcpAccessToken({
      grantId: grant.id,
      wallet: grant.wallet,
      secret: deps.env.SESSION_SECRET,
    });
    const refreshExp = Math.floor(Date.parse(grant.expiresAt) / 1000);
    const refreshToken = issueMcpRefreshToken({
      grantId: grant.id,
      wallet: grant.wallet,
      secret: deps.env.SESSION_SECRET,
      expiresAt: refreshExp,
    });
    grant.refreshTokenHash = hashToken(refreshToken);
    await saveGrant(store, grant);
    const cursorConfig = buildCursorMcpConfig({
      apiBase: deps.env.API_URL,
      accessToken: access.token,
    });
    const connectCard = buildConnectCard({
      mcpEndpoint,
      accessToken: access.token,
      wallet: grant.wallet,
      safeAddress: grant.safeAddress,
      chainId: deps.env.CHAIN_ID,
      scopes: grant.scopes,
      maxSpendPerTx0g: grant.maxSpendPerTx0g,
      dailyLimit0g: grant.dailyLimit0g,
      expiresAt: grant.expiresAt,
    });
    return {
      ok: true,
      grant: toPublic(grant),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      mcpEndpoint,
      cursorConfig,
      connectCard,
      setupPrompt: [connectCard, "", buildSetupPrompt({
        apiBase: deps.env.API_URL,
        webBase: deps.env.APP_URL,
        grantId: grant.id,
        wallet: grant.wallet,
        scopes: grant.scopes,
        maxSpendPerTx0g: grant.maxSpendPerTx0g,
        dailyLimit0g: grant.dailyLimit0g,
        expiresAt: grant.expiresAt,
        clientKind: grant.clientKind,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken,
        mcpEndpoint,
        cursorConfig,
      })].join("\n"),
      warning: "Access and refresh tokens are shown once. Revoke the grant if they leak. The agent never receives a private key.",
    };
  });

  app.post("/v1/mcp/grants/:grantId/revoke", async (req) => {
    const grantId = (req.params as { grantId: string }).grantId;
    const body = z.object({ wallet: z.string().min(42) }).parse(req.body);
    deps.requireWalletSession(req, body.wallet);
    const store = requireRedis(deps.redis);
    const existing = await getGrant(store, grantId);
    if (!existing || existing.wallet.toLowerCase() !== getAddress(body.wallet).toLowerCase()) {
      return { ok: true, grant: null };
    }
    const grant = await revokeGrant(store, grantId);
    return { ok: true, grant: grant ? toPublic(grant) : null };
  });

  app.get("/v1/mcp/grants/:grantId/activity", async (req) => {
    const grantId = (req.params as { grantId: string }).grantId;
    const wallet = String((req.query as { wallet?: string }).wallet ?? "");
    if (!wallet) throw new AppError("VALIDATION", { message: "wallet is required." });
    deps.requireWalletSession(req, wallet);
    const store = requireRedis(deps.redis);
    const grant = await getGrant(store, grantId);
    if (!grant || grant.wallet.toLowerCase() !== getAddress(wallet).toLowerCase()) {
      return { ok: true, events: [] };
    }
    const events = await listAudit(store, grantId);
    return { ok: true, events };
  });

  app.post("/v1/mcp/oauth/token", async (req) => {
    const body = z
      .object({
        grant_type: z.literal("refresh_token"),
        refresh_token: z.string().min(8),
      })
      .parse(req.body);
    const parsed = verifyMcpRefreshToken(body.refresh_token, deps.env.SESSION_SECRET);
    if (!parsed) throw new AppError("UNAUTHORIZED", { message: "Refresh token is invalid or expired." });
    const store = requireRedis(deps.redis);
    const grant = await getGrant(store, parsed.grantId);
    if (!grant || grant.refreshTokenHash !== hashToken(body.refresh_token)) {
      throw new AppError("UNAUTHORIZED");
    }
    const active = isGrantActive(grant);
    if (!active.ok) throw new AppError("UNAUTHORIZED", { message: active.reason });
    const access = issueMcpAccessToken({
      grantId: grant.id,
      wallet: grant.wallet,
      secret: deps.env.SESSION_SECRET,
    });
    return {
      ok: true,
      access_token: access.token,
      token_type: "Bearer",
      expires_in: access.expiresAt - Math.floor(Date.now() / 1000),
    };
  });

  app.post("/v1/mcp/test", async (req) => {
    const { grant } = await requireMcpGrant(deps, req);
    const tools = toolsForGrant(grant).map((t) => t.name);
    return {
      ok: true,
      message: "Beacon MCP grant is live.",
      safe: grant.safeAddress,
      wallet: grant.wallet,
      permissions: grant.scopes,
      perTransactionLimit: grant.maxSpendPerTx0g,
      dailyLimit: grant.dailyLimit0g,
      appDailyRemaining: grant.dailyLimit0g,
      emergencyPause: false,
      availableActions: tools,
      expiresAt: grant.expiresAt,
    };
  });

  const jsonRpc = async (req: { headers: { authorization?: string }; body: unknown }) => {
    const { grant, store } = await requireMcpGrant(deps, req);
    const limited = await checkRateLimit(store, grant.id);
    if (!limited.ok) {
      throw new AppError("RATE_LIMITED", { message: "MCP tool rate limit. Try again in a minute." });
    }
    const body = (req.body ?? {}) as JsonRpcRequest;
    return handleMcpJsonRpc(body, grant, async (name, args) => {
      const snapshot = grant.safeAddress
        ? await deps.vaultSnapshot(grant.safeAddress).catch(() => ({
            wealth: "0",
            paused: false,
            maxSpendPerTx: "0",
            windowSpent: "0",
            windowBudget: "0",
            windowSpent0g: 0,
          }))
        : { wealth: "0", paused: false, maxSpendPerTx: "0", windowSpent: "0", windowBudget: "0", windowSpent0g: 0 };
      const gated = gateTool(grant, name, args, {
        emergencyPause: snapshot.paused,
        dailySpend0g: grant.dailyLimit0g,
        perJobLimit0g: grant.maxSpendPerTx0g,
        spentToday0g: snapshot.windowSpent0g,
      });
      if (!gated.ok) {
        await appendAudit(store, {
          at: new Date().toISOString(),
          grantId: grant.id,
          wallet: grant.wallet,
          tool: name,
          ok: false,
          detail: gated.message,
        });
        return { content: [{ type: "text", text: `${gated.code}: ${gated.message}` }], isError: true };
      }
      const text = await runMcpTool(deps, grant, name, args, snapshot);
      await appendAudit(store, {
        at: new Date().toISOString(),
        grantId: grant.id,
        wallet: grant.wallet,
        tool: name,
        ok: true,
        detail: text.slice(0, 280),
        amount0g: gated.amount0g,
      });
      return { content: [{ type: "text", text }] };
    });
  };

  app.post("/mcp", jsonRpc);
  app.post("/v1/mcp", jsonRpc);
}

async function runMcpTool(
  deps: McpRouteDeps,
  grant: McpGrant,
  name: string,
  args: Record<string, unknown>,
  snapshot: {
    wealth: string;
    paused: boolean;
    maxSpendPerTx: string;
    windowSpent: string;
    windowBudget: string;
    windowSpent0g: number;
  },
): Promise<string> {
  if (name === "get_safe") {
    if (!grant.safeAddress) return "No Beacon Safe for this wallet. Create one at /flow/security.";
    return JSON.stringify(
      {
        safe: grant.safeAddress,
        chainId: deps.env.CHAIN_ID,
        wealth0g: snapshot.wealth,
        paused: snapshot.paused,
        maxSpendPerTx: snapshot.maxSpendPerTx,
      },
      null,
      2,
    );
  }
  if (name === "get_policy") {
    return JSON.stringify(
      {
        mcpPerTx0g: grant.maxSpendPerTx0g,
        mcpDaily0g: grant.dailyLimit0g,
        vaultMaxSpendPerTx: snapshot.maxSpendPerTx,
        vaultWindowBudget: snapshot.windowBudget,
        paused: snapshot.paused,
        scopes: grant.scopes,
      },
      null,
      2,
    );
  }
  if (name === "get_spend") {
    return JSON.stringify(
      {
        windowSpent: snapshot.windowSpent,
        windowBudget: snapshot.windowBudget,
        note: "windowSpent is Beacon Safe rolling window. Job escrow locks are separate. Do not add them.",
      },
      null,
      2,
    );
  }
  if (name === "get_supported_actions") {
    return JSON.stringify(toolsForGrant(grant).map((t) => t.name));
  }
  if (name === "get_job" || name === "get_receipt") {
    const jobId = String(args.jobId ?? "");
    const job = await deps.getJob(jobId);
    if (!job) return "Job not found.";
    if (job.wallet && job.wallet.toLowerCase() !== grant.wallet.toLowerCase() && job.wallet !== "0x0000000000000000000000000000000000000000") {
      return "Job is not owned by this wallet.";
    }
    if (name === "get_receipt") {
      return JSON.stringify(
        {
          jobId: job.id,
          status: job.status,
          lock0g: format0g(job.quote.lock0g),
          modelId: job.quote.modelId,
          storageRoot: job.storageRoot ?? null,
          lockTx: job.lockTx ?? null,
          releaseTx: job.releaseTx ?? null,
          refundTx: job.refundTx ?? null,
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      { id: job.id, status: job.status, task: job.task, brief: job.brief.slice(0, 500), modelId: job.quote.modelId },
      null,
      2,
    );
  }
  if (name === "create_job" || name === "infer" || name === "generate_image") {
    try {
      const brief =
        name === "generate_image"
          ? String(args.prompt ?? "")
          : name === "infer"
            ? String(args.prompt ?? "")
            : String(args.brief ?? "");
      if (brief.length < 4) return "Brief is required.";
      const task = name === "generate_image" ? "image" : "cheap";
      const job = await deps.createQuotedJob({
        wallet: grant.wallet,
        task,
        brief,
        serviceId: name === "generate_image" ? "image" : String(args.service ?? "research"),
      });
      const lock0g = Number(format0g(job.quote.lock0g).replace(/ 0G$/, ""));
      if (lock0g > grant.maxSpendPerTx0g + 1e-18) {
        return `MCP_TX_LIMIT: quoted ${lock0g} 0G exceeds grant max ${grant.maxSpendPerTx0g} 0G.`;
      }
      let ran: JobLite = job;
      if (deps.lockAndRunJob && grant.safeAddress) {
        try {
          ran = await deps.lockAndRunJob({ jobId: job.id, wallet: grant.wallet });
        } catch (err) {
          return JSON.stringify(
            {
              jobId: job.id,
              status: job.status,
              quoted: format0g(job.quote.lock0g),
              modelId: job.quote.modelId,
              honesty: isAppError(err)
                ? err.userMessage
                : "Quoted. Safe lock failed. Open the job in Flow — MCP does not skip TeeML or policy.",
            },
            null,
            2,
          );
        }
      }
      return JSON.stringify(
        {
          jobId: ran.id,
          status: ran.status,
          modelId: ran.quote.modelId,
          lock0g: format0g(ran.quote.lock0g),
          lockTx: ran.lockTx ?? null,
          proof: `/verify/${ran.id}`,
          desk: `/flow/desk?job=${ran.id}`,
          honesty: ran.lockTx
            ? "Locked from Beacon Safe by the allowlisted executor. The MCP token is not a private key. Compute runs asynchronously — call get_job."
            : "Quoted only. No Safe is linked, so Beacon will not invent a lock. Create a Safe at /flow/security.",
        },
        null,
        2,
      );
    } catch (err) {
      return isAppError(err) ? err.userMessage : "Job quote failed.";
    }
  }
  if (name === "swap") {
    try {
      const amount = Number(args.amount0g);
      if (!Number.isFinite(amount) || amount <= 0) return "amount0g must be > 0.";
      const quote = await quoteZiaPair({
        amountIn: BigInt(Math.round(amount * 1e18)),
        tokenIn: "0G",
        tokenOut: "USDC",
      });
      if (!quote.executableFromSafe) {
        return quote.executeBlock || "Beacon Safe cannot execute this direction.";
      }
      if (!deps.executeSafeSwap) {
        return JSON.stringify({
          quoted: true,
          amountOut: quote.amountOut.toString(),
          tokenOut: quote.tokenOutSymbol,
          honesty: "Quote is live. Execute from Flow with an unlocked Beacon Agent session.",
        });
      }
      const result = await deps.executeSafeSwap({
        wallet: grant.wallet,
        amountInUnits: String(amount),
        tokenIn: "0G",
        tokenOut: "USDC",
      });
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return isAppError(err) ? err.userMessage : "Swap failed.";
    }
  }
  if (name === "inspect") {
    const addr = String(args.address ?? "");
    const txHash = String(args.txHash ?? "");
    if (txHash.startsWith("0x") && txHash.length >= 66 && deps.inspectTransaction) {
      return JSON.stringify(await deps.inspectTransaction(txHash), null, 2);
    }
    if (addr.startsWith("0x") && addr.length === 42 && deps.inspectAddress) {
      return JSON.stringify(await deps.inspectAddress(addr), null, 2);
    }
    return "Pass address (0x + 40 hex) or txHash (0x + 64 hex).";
  }
  if (name === "bridge") {
    if (!deps.quoteBridge) {
      return "Bridge quotes are not wired on this API process.";
    }
    try {
      const quoted = await deps.quoteBridge(String(args.text ?? ""), grant.wallet);
      return JSON.stringify(quoted, null, 2);
    } catch (err) {
      return isAppError(err) ? err.userMessage : "Bridge quote failed.";
    }
  }
  if (name === "pause_safe") {
    return "Pause is owner-signed setPaused on the Safe. Open /flow/security. The executor cannot pause.";
  }
  return `Unknown tool: ${name}`;
}
