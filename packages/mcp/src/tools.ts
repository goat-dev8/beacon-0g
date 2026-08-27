import { authorizeToolCall, type SpendPolicySnapshot } from "./policyGate.js";
import type { McpGrant } from "./grants.js";
import { hasScope, type McpScope } from "./scopes.js";

export type McpToolDef = {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOL_DEFS: McpToolDef[] = [
  {
    name: "get_safe",
    description: "Get the user's Beacon vault address and status on 0G Aristotle (16661).",
    scope: "read:safe",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_policy",
    description: "Get MCP agent limits and Beacon vault spending policy (native 0G).",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_spend",
    description: "Get remaining daily / per-tx 0G budget for this vault session.",
    scope: "read:spend",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_job",
    description: "Get an Agent Job by id (only jobs owned by this user).",
    scope: "read:jobs",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", minLength: 8 } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_receipt",
    description: "Get a job receipt: amount0g, storageRoot, teeSigner, quoteHash.",
    scope: "read:receipts",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", minLength: 8 } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_supported_actions",
    description: "List tools this agent may use given its scopes and current policy.",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_job",
    description: "Create an Agent Job (quote path in native 0G from the Compute Router catalog).",
    scope: "exec:job",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", minLength: 2, maxLength: 40 },
        brief: { type: "string", minLength: 8, maxLength: 4000 },
      },
      required: ["service", "brief"],
      additionalProperties: false,
    },
  },
  {
    name: "infer",
    description: "Run a text inference job on 0G Compute within vault limits.",
    scope: "exec:infer",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 8000 },
        amount0g: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_image",
    description: "Run a TeeML image job (z-image-turbo) within vault limits.",
    scope: "exec:image",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 4000 },
        amount0g: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "swap",
    description:
      "Beacon vault swap on Aristotle: spend W0G via Zia exactInputSingle (fee 3000) to Bridged USDC. amount0g is native 0G in.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amount0g: { type: "number", exclusiveMinimum: 0 },
        note: { type: "string", maxLength: 200 },
      },
      required: ["amount0g"],
      additionalProperties: false,
    },
  },
  {
    name: "pause_safe",
    description: "Pause the Beacon vault so the executor cannot spend.",
    scope: "exec:pause",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function toolsForGrant(grant: McpGrant): McpToolDef[] {
  return MCP_TOOL_DEFS.filter((t) => hasScope(grant.scopes, t.scope));
}

export function spendAmountFromArgs(args: Record<string, unknown>): number {
  if (typeof args.amount0g === "number" && Number.isFinite(args.amount0g)) {
    return args.amount0g;
  }
  return 0;
}

export function gateTool(
  grant: McpGrant,
  toolName: string,
  args: Record<string, unknown>,
  policy: SpendPolicySnapshot,
) {
  const def = MCP_TOOL_DEFS.find((t) => t.name === toolName);
  if (!def) {
    return {
      ok: false as const,
      code: "UNKNOWN_TOOL",
      message: `Unknown tool: ${toolName}`,
    };
  }
  const amount = spendAmountFromArgs(args);
  const authz = authorizeToolCall({
    grant,
    neededScope: def.scope,
    amount0g: amount,
    policy,
  });
  if (!authz.ok) {
    return { ok: false as const, code: authz.code, message: authz.message, def };
  }
  return { ok: true as const, def, amount0g: authz.amount0g };
}
