import { BEACON_MCP_INSTRUCTIONS } from "./policyGate.js";
import { toolsForGrant, type McpToolDef } from "./tools.js";
import type { McpGrant } from "./grants.js";
import { SCOPE_LABELS } from "./scopes.js";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)) {
    return requested;
  }
  return "2025-03-26";
}

export function isMcpNotification(body: JsonRpcRequest): boolean {
  return (
    typeof body.method === "string" &&
    body.method.startsWith("notifications/") &&
    (body.id === undefined || body.id === null)
  );
}

export function mcpInitializeResult(grant: McpGrant, requestedProtocol?: unknown) {
  return {
    protocolVersion: negotiateProtocolVersion(requestedProtocol),
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
    },
    serverInfo: {
      name: "beacon-mcp",
      version: "0.3.0",
    },
    instructions: [
      BEACON_MCP_INSTRUCTIONS,
      "",
      `Wallet: ${grant.wallet}`,
      `Safe: ${grant.safeAddress ?? "not linked"}`,
      `Client: ${grant.clientLabel}`,
      `Scopes: ${grant.scopes.join(", ")}`,
      `Per-tx limit: ${grant.maxSpendPerTx0g} 0G`,
      `Daily limit: ${grant.dailyLimit0g} 0G`,
      `Expires: ${grant.expiresAt}`,
    ].join("\n"),
  };
}

export function mcpToolsListResult(grant: McpGrant) {
  const tools = toolsForGrant(grant).map((t: McpToolDef) => ({
    name: t.name,
    description: `${t.description} [scope: ${t.scope} — ${SCOPE_LABELS[t.scope]}]`,
    inputSchema: t.inputSchema,
  }));
  return { tools };
}

export function mcpResourcesListResult(_grant: McpGrant) {
  return {
    resources: [
      {
        uri: "beacon://instructions",
        name: "Beacon MCP instructions",
        mimeType: "text/plain",
        description: "How to use Beacon safely with this agent.",
      },
      {
        uri: "beacon://grant",
        name: "Current authorization",
        mimeType: "application/json",
        description: "Active MCP grant summary (no secrets).",
      },
    ],
  };
}

export function mcpResourceRead(grant: McpGrant, uri: string) {
  if (uri === "beacon://instructions") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: BEACON_MCP_INSTRUCTIONS,
        },
      ],
    };
  }
  if (uri === "beacon://grant") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              grantId: grant.id,
              wallet: grant.wallet,
              safeAddress: grant.safeAddress,
              clientKind: grant.clientKind,
              scopes: grant.scopes,
              maxSpendPerTx0g: grant.maxSpendPerTx0g,
              dailyLimit0g: grant.dailyLimit0g,
              expiresAt: grant.expiresAt,
              revoked: Boolean(grant.revokedAt),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  return null;
}

export function handleMcpJsonRpc(
  body: JsonRpcRequest,
  grant: McpGrant,
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
): Promise<JsonRpcResponse> | JsonRpcResponse {
  const id = (body.id ?? null) as JsonRpcId;
  const method = body.method;

  if (method === "initialize") {
    const requested =
      typeof body.params === "object" && body.params && "protocolVersion" in body.params
        ? (body.params as { protocolVersion?: unknown }).protocolVersion
        : undefined;
    return ok(id, mcpInitializeResult(grant, requested));
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return ok(id, {});
  }
  if (method === "ping") {
    return ok(id, {});
  }
  if (method === "tools/list") {
    return ok(id, mcpToolsListResult(grant));
  }
  if (method === "resources/list") {
    return ok(id, mcpResourcesListResult(grant));
  }
  if (method === "resources/read") {
    const uri =
      typeof body.params === "object" &&
      body.params &&
      "uri" in body.params &&
      typeof (body.params as { uri: unknown }).uri === "string"
        ? (body.params as { uri: string }).uri
        : "";
    const result = mcpResourceRead(grant, uri);
    if (!result) return err(id, -32002, `Unknown resource: ${uri}`);
    return ok(id, result);
  }
  if (method === "tools/call") {
    const params = (body.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (!params.name) return err(id, -32602, "tools/call requires name");
    return callTool(params.name, params.arguments ?? {}).then((result) => ok(id, result));
  }

  return err(id, -32601, `Method not found: ${method}`);
}

export { ok as jsonRpcOk, err as jsonRpcErr };
