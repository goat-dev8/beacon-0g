export * from "./scopes.js";
export * from "./tokens.js";
export * from "./grants.js";
export * from "./policyGate.js";
export * from "./tools.js";
export * from "./protocol.js";

export function buildSetupPrompt(opts: {
  apiBase: string;
  webBase: string;
  grantId: string;
  wallet: string;
  scopes: string[];
  maxSpendPerTx0g: number;
  dailyLimit0g: number;
  expiresAt: string;
  clientKind: "claude" | "cursor" | "generic";
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  mcpEndpoint: string;
  cursorConfig: string;
}): string {
  const api = opts.apiBase.replace(/\/$/, "");
  const web = opts.webBase.replace(/\/$/, "");
  const accessExp = new Date(opts.accessTokenExpiresAt * 1000).toISOString();
  const clientSetup =
    opts.clientKind === "cursor"
      ? [
          "Cursor setup:",
          "1) Open Cursor Settings → MCP (or edit ~/.cursor/mcp.json).",
          "2) Paste the mcpServers.beacon block from the Cursor config below.",
          "3) Restart MCP / reload Cursor windows if tools do not appear.",
          "4) In chat, ask the agent to list Beacon MCP tools and call get_safe + get_policy.",
        ]
      : opts.clientKind === "claude"
        ? [
            "Claude setup:",
            "1) Add a remote MCP server with the endpoint below.",
            "2) Set Authorization header: Bearer <access_token>.",
            "3) Paste this whole prompt into Claude after the server is connected.",
            "4) Ask Claude to list tools, then call get_safe and get_policy.",
          ]
        : [
            "Generic MCP client setup:",
            "1) Point the client at the MCP endpoint (JSON-RPC POST).",
            "2) Send header Authorization: Bearer <access_token> on every request.",
            "3) Call initialize, then tools/list, then get_safe + get_policy.",
            `4) When the access token expires (~1h), POST ${api}/v1/mcp/oauth/token with grant_type=refresh_token.`,
          ];

  return [
    "You are helping me use Beacon via Beacon MCP.",
    "",
    "Beacon is a 0G Aristotle desk: intent → quote (neurons/0G) → policy → TeeML → execute → receipt.",
    "Never ask for or handle my private key / seed. Beacon Safe policy is the final spend boundary.",
    "",
    "=== Session (keep private; do not post publicly) ===",
    `MCP endpoint: ${opts.mcpEndpoint}`,
    `Connect Agents page: ${web}/mcp`,
    `Grant id: ${opts.grantId}`,
    `Wallet: ${opts.wallet}`,
    `Client: ${opts.clientKind}`,
    `Scopes: ${opts.scopes.join(", ")}`,
    `Per-tx limit: ${opts.maxSpendPerTx0g} 0G`,
    `Daily limit: ${opts.dailyLimit0g} 0G`,
    `Grant expires: ${opts.expiresAt}`,
    `Access token (expires ${accessExp}):`,
    opts.accessToken,
    `Refresh token (renew access; keep secret):`,
    opts.refreshToken,
    `Token refresh URL: ${api}/v1/mcp/oauth/token`,
    `Refresh body example: {"grant_type":"refresh_token","refresh_token":"<refresh_token>"}`,
    "",
    "=== Cursor / MCP client config (mcp.json) ===",
    opts.cursorConfig,
    "",
    "=== How to set up ===",
    ...clientSetup,
    "",
    "=== After connected, do this ===",
    "1) Confirm Beacon MCP tools are available (tools/list).",
    "2) Call get_safe and get_policy.",
    "3) Summarize what you can and cannot do under scopes + limits.",
    "4) Never exceed policy; if a tool returns MCP_TX_LIMIT / SCOPE_DENIED / SAFE_PAUSED, stop and explain.",
    "5) Never ask for a private key. Execution uses the Beacon Safe + allowlisted executor.",
    "6) When setup looks good, reply with:",
    "Beacon connected.",
    "Safe: …",
    "Permissions: …",
    "Per-transaction limit: …",
    "Daily limit: …",
    "Available actions: …",
  ].join("\n");
}

export function buildCursorMcpConfig(opts: {
  apiBase: string;
  accessToken: string;
}): string {
  const url = `${opts.apiBase.replace(/\/$/, "")}/mcp`;
  return JSON.stringify(
    {
      mcpServers: {
        "beacon-0g": {
          url,
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function buildConnectCard(opts: {
  mcpEndpoint: string;
  accessToken: string;
  wallet: string;
  safeAddress: string | null;
  chainId: number;
  scopes: string[];
  maxSpendPerTx0g: number;
  dailyLimit0g: number;
  expiresAt: string;
}): string {
  return [
    "BEACON MCP",
    "",
    "Endpoint:",
    opts.mcpEndpoint,
    "",
    "Authorization:",
    `Bearer ${opts.accessToken}`,
    "",
    "Wallet:",
    opts.wallet,
    "",
    "Safe:",
    opts.safeAddress ?? "not linked — create one at /flow/security",
    "",
    "Chain:",
    String(opts.chainId),
    "",
    "Scopes:",
    ...opts.scopes,
    "",
    "Max transaction:",
    `${opts.maxSpendPerTx0g} 0G`,
    "",
    "Daily cap:",
    `${opts.dailyLimit0g} 0G`,
    "",
    "Expires:",
    opts.expiresAt,
    "",
    "Install:",
    "Paste this into your MCP client configuration.",
  ].join("\n");
}
