import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getAddress } from "ethers";
import { AppError, format0g, isAppError } from "@beacon/shared";
import {
  DEFAULT_CONNECT_SCOPES,
  MCP_ACCESS_TTL_SECONDS,
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
  isMcpNotification,
  isSafeRedirectUri,
  issueMcpAccessToken,
  issueMcpRefreshToken,
  hashToken,
  listAudit,
  listGrantsForWallet,
  mcpWwwAuthenticate,
  newAuthCode,
  newGrantId,
  oauthAuthorizationServer,
  oauthProtectedResource,
  parseOauthTokenBody,
  revokeGrant,
  saveGrant,
  toolsForGrant,
  verifyMcpAccessToken,
  verifyMcpRefreshToken,
  verifyPkce,
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
  denial?: string;
};

export type McpRouteDeps = {
  env: {
    SESSION_SECRET: string;
    API_URL: string;
    APP_URL: string;
    CHAIN_ID: number;
    ZEROG_EXPLORER?: string;
  };
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
  listJobs?: (wallet: string) => Promise<JobLite[]>;
  listHistory?: (wallet: string) => Promise<unknown[]>;
  lastDenial?: (wallet: string) => Promise<{ reason: string; jobId?: string; fundsMoved: string } | null>;
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
  listSwapAssets?: () => Promise<unknown>;
  preflightSwap?: (input: {
    wallet: string;
    amount0g: number;
    tokenIn?: string;
    tokenOut?: string;
  }) => Promise<{ verdict: "ALLOW" | "DENY"; reason: string; intentHash?: string; quote?: unknown }>;
  spendReport?: (wallet: string) => Promise<{
    report: { lanes: unknown[]; honesty: string };
    windows?: Record<string, { lanes: unknown[] }>;
    vault?: unknown;
  }>;
  recordActivity?: (
    wallet: string,
    kind: string,
    title: string,
    meta?: Record<string, unknown>,
    explorerUrl?: string,
    refId?: string,
  ) => Promise<void>;
  executeSafeSwap?: (input: {
    wallet: string;
    amountInUnits: string;
    tokenIn: string;
    tokenOut: string;
  }) => Promise<{
    spendHash: string;
    fulfillHash: string;
    amountOut: string;
    tokenOut: string;
    amountIn?: string;
    tokenIn?: string;
    explorerSpend?: string;
    explorerFulfill?: string;
    intentHash?: string;
  }>;
};

type OauthCodeRecord = {
  grantId: string;
  wallet: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
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

function proofUrl(deps: McpRouteDeps, jobId: string): string {
  return `${deps.env.APP_URL.replace(/\/$/, "")}/verify/${jobId}`;
}

function challenge(reply: FastifyReply, apiBase: string): void {
  reply.header("WWW-Authenticate", mcpWwwAuthenticate(apiBase));
  reply.header("MCP-Protocol-Version", "2025-03-26");
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

function registerFormParser(app: FastifyInstance): void {
  try {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          const params = new URLSearchParams(String(body ?? ""));
          const obj: Record<string, string> = {};
          for (const [key, value] of params.entries()) obj[key] = value;
          done(null, obj);
        } catch (err) {
          done(err as Error);
        }
      },
    );
  } catch {
    /* already registered */
  }
}

export function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps) {
  const mcpEndpoint = `${deps.env.API_URL.replace(/\/$/, "")}/mcp`;
  const apiBase = deps.env.API_URL.replace(/\/$/, "");
  const webBase = deps.env.APP_URL.replace(/\/$/, "");
  registerFormParser(app);

  const protectedResource = oauthProtectedResource({
    apiBase,
    webBase,
    scopes: DEFAULT_CONNECT_SCOPES,
  });
  const authorizationServer = oauthAuthorizationServer({ apiBase, webBase });

  app.get("/.well-known/oauth-protected-resource", async () => protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", async () => protectedResource);
  app.get("/.well-known/oauth-authorization-server", async () => authorizationServer);
  app.get("/.well-known/oauth-authorization-server/mcp", async () => authorizationServer);

  app.get("/v1/mcp/health", async () => ({
    ok: true,
    service: "beacon-0g",
    redis: Boolean(deps.redis),
    endpoint: deps.redis ? mcpEndpoint : "",
    connectPage: "/flow/mcp",
    chainId: deps.env.CHAIN_ID,
    authorization: "Bearer MCP access token or OAuth authorization_code (PKCE)",
  }));

  app.get("/mcp", async (req, reply) => {
    if (!deps.bearerToken(req)) {
      challenge(reply, apiBase);
      return reply.code(401).send({
        error: "unauthorized",
        authorization: "Bearer",
        resource_metadata: `${apiBase}/.well-known/oauth-protected-resource`,
      });
    }
    reply.header("Allow", "POST");
    reply.header("MCP-Protocol-Version", "2025-03-26");
    return reply.code(405).send({
      error: "method_not_allowed",
      honesty: "Beacon MCP is JSON-RPC over POST /mcp. GET is not an event stream.",
    });
  });

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
    const scopes = filterValidScopes(body.scopes);
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
      setupPrompt: [
        connectCard,
        "",
        buildSetupPrompt({
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
        }),
      ].join("\n"),
      warning:
        "Access and refresh tokens are shown once. Revoke the grant if they leak. The agent never receives a private key.",
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

  app.post("/v1/mcp/oauth/register", async (req) => {
    const body = z
      .object({
        client_name: z.string().max(80).optional(),
        redirect_uris: z.array(z.string().min(8)).min(1),
        token_endpoint_auth_method: z.string().optional(),
      })
      .parse(req.body ?? {});
    for (const uri of body.redirect_uris) {
      if (!isSafeRedirectUri(uri)) {
        throw new AppError("VALIDATION", { message: "redirect_uris contains an unsafe URI." });
      }
    }
    const clientId = `beacon_mcp_${newGrantId().slice(4)}`;
    const store = requireRedis(deps.redis);
    await store.set(
      `mcp:oauth-client:${clientId}`,
      {
        client_id: clientId,
        client_name: body.client_name ?? "MCP client",
        redirect_uris: body.redirect_uris,
        created_at: new Date().toISOString(),
      },
      { ex: 90 * 24 * 3600 },
    );
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  });

  app.post("/v1/mcp/oauth/code", async (req) => {
    const body = z
      .object({
        wallet: z.string().min(42),
        grantId: z.string().min(8),
        codeChallenge: z.string().min(20),
        codeChallengeMethod: z.literal("S256").optional(),
        redirectUri: z.string().min(8),
        clientId: z.string().min(3),
        state: z.string().max(512).optional(),
      })
      .parse(req.body ?? {});
    deps.requireWalletSession(req, body.wallet);
    if (!isSafeRedirectUri(body.redirectUri)) {
      throw new AppError("VALIDATION", { message: "redirectUri is not allowed." });
    }
    const store = requireRedis(deps.redis);
    const grant = await getGrant(store, body.grantId);
    if (
      !grant ||
      grant.wallet.toLowerCase() !== getAddress(body.wallet).toLowerCase() ||
      !isGrantActive(grant).ok
    ) {
      throw new AppError("VALIDATION", { message: "Active grant required." });
    }
    const code = newAuthCode();
    await store.set(
      `mcp:oauth-code:${code}`,
      {
        grantId: grant.id,
        wallet: grant.wallet,
        codeChallenge: body.codeChallenge,
        redirectUri: body.redirectUri,
        clientId: body.clientId,
      } satisfies OauthCodeRecord,
      { ex: 5 * 60 },
    );
    return { ok: true, code, state: body.state ?? null, expiresIn: 300 };
  });

  app.post("/v1/mcp/oauth/token", async (req, reply) => {
    const fields = parseOauthTokenBody(req.body);
    const grantType = fields.grant_type;
    const store = requireRedis(deps.redis);

    if (grantType === "refresh_token") {
      const refreshToken = fields.refresh_token;
      if (!refreshToken) throw new AppError("VALIDATION", { message: "refresh_token required" });
      const parsed = verifyMcpRefreshToken(refreshToken, deps.env.SESSION_SECRET);
      if (!parsed) throw new AppError("UNAUTHORIZED", { message: "Refresh token is invalid or expired." });
      const grant = await getGrant(store, parsed.grantId);
      if (!grant || grant.refreshTokenHash !== hashToken(refreshToken)) {
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
        expires_in: MCP_ACCESS_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: grant.scopes.join(" "),
      };
    }

    if (grantType !== "authorization_code") {
      throw new AppError("VALIDATION", { message: "grant_type must be authorization_code or refresh_token." });
    }
    if (!fields.code || !fields.code_verifier || !fields.redirect_uri) {
      throw new AppError("VALIDATION", { message: "code, code_verifier, redirect_uri required" });
    }
    const stored = await store.get<OauthCodeRecord>(`mcp:oauth-code:${fields.code}`);
    if (!stored) throw new AppError("UNAUTHORIZED", { message: "Invalid or expired authorization code." });
    await store.del(`mcp:oauth-code:${fields.code}`);
    if (stored.redirectUri !== fields.redirect_uri) {
      throw new AppError("UNAUTHORIZED", { message: "redirect_uri mismatch" });
    }
    if (!verifyPkce(fields.code_verifier, stored.codeChallenge)) {
      throw new AppError("UNAUTHORIZED", { message: "PKCE verification failed" });
    }
    const grant = await getGrant(store, stored.grantId);
    if (!grant || !isGrantActive(grant).ok) {
      throw new AppError("UNAUTHORIZED", { message: "Grant inactive" });
    }
    const access = issueMcpAccessToken({
      grantId: grant.id,
      wallet: grant.wallet,
      secret: deps.env.SESSION_SECRET,
    });
    let refresh: string | undefined;
    if (!grant.refreshTokenHash) {
      refresh = issueMcpRefreshToken({
        grantId: grant.id,
        wallet: grant.wallet,
        secret: deps.env.SESSION_SECRET,
        expiresAt: Math.floor(Date.parse(grant.expiresAt) / 1000),
      });
      await saveGrant(store, { ...grant, refreshTokenHash: hashToken(refresh) });
    }
    reply.header("Cache-Control", "no-store");
    return {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: grant.scopes.join(" "),
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

  const jsonRpc = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { grant, store } = await requireMcpGrant(deps, req);
      const limited = await checkRateLimit(store, grant.id);
      if (!limited.ok) {
        throw new AppError("RATE_LIMITED", { message: "MCP tool rate limit. Try again in a minute." });
      }
      const body = (req.body ?? {}) as JsonRpcRequest;
      if (isMcpNotification(body)) {
        return reply.code(202).send();
      }
      if (!body.method) {
        return reply.code(400).send({ error: "JSON-RPC method required" });
      }
      reply.header("Content-Type", "application/json");
      reply.header("MCP-Protocol-Version", "2025-03-26");
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
        const text = await runMcpTool(deps, grant, name, args, snapshot, store);
        const txMatch = text.match(/0x[a-fA-F0-9]{64}/);
        await appendAudit(store, {
          at: new Date().toISOString(),
          grantId: grant.id,
          wallet: grant.wallet,
          tool: name,
          ok: !text.startsWith("DENY") && !text.includes("MCP_TX_LIMIT"),
          detail: text.slice(0, 280),
          amount0g: gated.amount0g,
          txHash: txMatch?.[0],
        });
        return { content: [{ type: "text", text }] };
      });
    } catch (err) {
      if (isAppError(err) && err.code === "UNAUTHORIZED") {
        challenge(reply, apiBase);
        return reply.code(401).send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: err.userMessage, data: { code: err.code } },
        });
      }
      throw err;
    }
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
  store: RedisLike,
): Promise<string> {
  const web = deps.env.APP_URL.replace(/\/$/, "");

  if (name === "get_safe" || name === "get_balance") {
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
    const ledgers = deps.spendReport ? await deps.spendReport(grant.wallet) : null;
    return JSON.stringify(
      {
        windowSpent: snapshot.windowSpent,
        windowBudget: snapshot.windowBudget,
        honesty:
          ledgers?.report.honesty ??
          "windowSpent is Beacon Safe rolling window. Job escrow locks are separate. Do not add them.",
        lanes: ledgers?.report.lanes ?? null,
        windows: ledgers?.windows ?? null,
        vault: ledgers?.vault ?? null,
        note: "Safe windowSpent is 24h. It appears under Today only. Never add escrow + Safe + swap + gas.",
      },
      null,
      2,
    );
  }
  if (name === "get_supported_actions") {
    return JSON.stringify(toolsForGrant(grant).map((t) => t.name));
  }
  if (name === "get_jobs") {
    const jobs = deps.listJobs ? await deps.listJobs(grant.wallet) : [];
    return JSON.stringify(
      jobs.slice(0, 20).map((j) => ({
        id: j.id,
        status: j.status,
        task: j.task,
        modelId: j.quote.modelId,
        proof: proofUrl(deps, j.id),
      })),
      null,
      2,
    );
  }
  if (name === "get_history") {
    const rows = deps.listHistory ? await deps.listHistory(grant.wallet) : [];
    return JSON.stringify(rows.slice(0, 30), null, 2);
  }
  if (name === "why_denied") {
    const last = deps.lastDenial ? await deps.lastDenial(grant.wallet) : null;
    if (!last) {
      return JSON.stringify({
        verdict: "none",
        reason: "No last denial on file for this wallet.",
      });
    }
    return JSON.stringify(last, null, 2);
  }
  if (name === "revoke_agent") {
    await revokeGrant(store, grant.id);
    return JSON.stringify({
      ok: true,
      grantId: grant.id,
      revoked: true,
      honesty: "This Bearer token and refresh token no longer work.",
    });
  }
  if (name === "get_job" || name === "get_receipt" || name === "verify_job" || name === "get_proof") {
    const jobId = String(args.jobId ?? "");
    const job = await deps.getJob(jobId);
    if (!job) return "Job not found.";
    if (
      job.wallet &&
      job.wallet.toLowerCase() !== grant.wallet.toLowerCase() &&
      job.wallet !== "0x0000000000000000000000000000000000000000"
    ) {
      return "Job is not owned by this wallet.";
    }
    return JSON.stringify(
      {
        jobId: job.id,
        status: job.status,
        task: job.task,
        brief: job.brief.slice(0, 500),
        lock0g: format0g(job.quote.lock0g),
        modelId: job.quote.modelId,
        storageRoot: job.storageRoot ?? null,
        lockTx: job.lockTx ?? null,
        releaseTx: job.releaseTx ?? null,
        refundTx: job.refundTx ?? null,
        proof: proofUrl(deps, job.id),
        proofUrl: proofUrl(deps, job.id),
      },
      null,
      2,
    );
  }
  if (name === "create_job" || name === "infer" || name === "generate_image" || name === "research") {
    try {
      const brief =
        name === "generate_image" || name === "infer"
          ? String(args.prompt ?? args.brief ?? "")
          : String(args.brief ?? args.prompt ?? "");
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
      if (deps.recordActivity) {
        await deps.recordActivity(
          grant.wallet,
          "mcp",
          `MCP ${name} · ${ran.id.slice(0, 8)}`,
          {
            agent: grant.clientLabel,
            session: grant.id,
            tool: name,
            wallet: grant.wallet,
            safe: grant.safeAddress,
            job: ran.id,
            status: ran.status,
          },
          ran.lockTx ? `${deps.env.ZEROG_EXPLORER ?? "https://chainscan.0g.ai"}/tx/${ran.lockTx}` : undefined,
          ran.id,
        );
      }
      return JSON.stringify(
        {
          jobId: ran.id,
          status: ran.status,
          modelId: ran.quote.modelId,
          lock0g: format0g(ran.quote.lock0g),
          lockTx: ran.lockTx ?? null,
          proof: proofUrl(deps, ran.id),
          proofUrl: proofUrl(deps, ran.id),
          desk: `${web}/flow/desk?job=${ran.id}`,
          honesty: ran.lockTx
            ? "Locked from Beacon Safe by the allowlisted executor. The MCP token is not a private key."
            : "Quoted only. No Safe is linked, so Beacon will not invent a lock. Create a Safe at /flow/security.",
        },
        null,
        2,
      );
    } catch (err) {
      return isAppError(err) ? err.userMessage : "Job quote failed.";
    }
  }
  if (name === "quote_swap" || name === "list_swap_assets" || name === "preflight_tx" || name === "swap" || name === "execute_swap") {
    if (name === "list_swap_assets") {
      if (!deps.listSwapAssets) return "Swap asset list is not wired on this API process.";
      return JSON.stringify(await deps.listSwapAssets(), null, 2);
    }
    try {
      const amount = Number(args.amount0g);
      if (!Number.isFinite(amount) || amount <= 0) return "amount0g must be > 0.";
      const tokenIn = String(args.tokenIn ?? "0G");
      const tokenOut = String(args.tokenOut ?? "USDC");
      if (name === "quote_swap") {
        const quote = await quoteZiaPair({
          amountIn: BigInt(Math.round(amount * 1e18)),
          tokenIn,
          tokenOut,
        });
        return JSON.stringify(
          {
            quoted: true,
            tokenIn: quote.tokenInSymbol,
            tokenOut: quote.tokenOutSymbol,
            amountIn: quote.amountIn.toString(),
            amountOut: quote.amountOut.toString(),
            minOut: quote.minOut.toString(),
            impactBps: quote.impactBps,
            fee: quote.fee,
            route: `exactInputSingle ${quote.tokenInSymbol}→${quote.tokenOutSymbol} fee ${quote.fee}`,
            executableFromSafe: quote.executableFromSafe,
            executeBlock: quote.executeBlock,
          },
          null,
          2,
        );
      }
      if (name === "preflight_tx") {
        if (!deps.preflightSwap) return "Preflight is not wired on this API process.";
        const decision = await deps.preflightSwap({
          wallet: grant.wallet,
          amount0g: amount,
          tokenIn,
          tokenOut,
        });
        return JSON.stringify(decision, null, 2);
      }
      if (deps.preflightSwap) {
        const decision = await deps.preflightSwap({
          wallet: grant.wallet,
          amount0g: amount,
          tokenIn,
          tokenOut,
        });
        if (decision.verdict === "DENY") {
          return JSON.stringify({ verdict: "DENY", reason: decision.reason, intentHash: decision.intentHash });
        }
      }
      const quote = await quoteZiaPair({
        amountIn: BigInt(Math.round(amount * 1e18)),
        tokenIn,
        tokenOut,
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
        tokenIn,
        tokenOut,
      });
      const proof = result.explorerFulfill ?? result.fulfillHash;
      if (deps.recordActivity) {
        await deps.recordActivity(
          grant.wallet,
          "swap",
          `MCP swap · ${amount} ${result.tokenIn ?? tokenIn} → ${result.tokenOut}`,
          {
            agent: grant.clientLabel,
            session: grant.id,
            tool: name,
            wallet: grant.wallet,
            safe: grant.safeAddress,
            tx: result.fulfillHash,
            status: "filled",
            amountInDisplay: String(amount),
          },
          result.explorerFulfill,
          result.fulfillHash,
        );
      }
      return JSON.stringify(
        {
          ok: true,
          input: result.amountIn ?? String(amount),
          output: result.amountOut,
          tokenIn: result.tokenIn ?? tokenIn,
          tokenOut: result.tokenOut,
          route: `exactInputSingle ${result.tokenIn ?? tokenIn}→${result.tokenOut}`,
          tx: result.fulfillHash,
          spendHash: result.spendHash,
          fulfillHash: result.fulfillHash,
          proof,
          proofUrl: result.explorerFulfill ?? proof,
          intentHash: result.intentHash ?? null,
        },
        null,
        2,
      );
    } catch (err) {
      return isAppError(err) ? err.userMessage : "Swap failed.";
    }
  }
  if (name === "inspect" || name === "inspect_wallet" || name === "inspect_contract" || name === "inspect_transaction") {
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
  if (name === "bridge" || name === "quote_bridge" || name === "track_bridge") {
    if (!deps.quoteBridge) {
      return "Bridge quotes are not wired on this API process.";
    }
    try {
      const quoted = await deps.quoteBridge(String(args.text ?? ""), grant.wallet);
      if (deps.recordActivity) {
        await deps.recordActivity(
          grant.wallet,
          "bridge",
          `MCP bridge quote`,
          {
            agent: grant.clientLabel,
            session: grant.id,
            tool: name,
            wallet: grant.wallet,
            safe: grant.safeAddress,
            status: "quoted",
          },
        );
      }
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
