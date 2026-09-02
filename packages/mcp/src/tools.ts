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
    name: "get_balance",
    description: "Native 0G + W0G wealth on the linked Beacon Safe (same evidence as get_safe).",
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
    description:
      "Four spend ledgers for 1d / 7d / 30d. Live Safe windowSpent is shown under Today only. Never add lanes.",
    scope: "read:spend",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_jobs",
    description: "List recent Agent Jobs owned by this wallet.",
    scope: "read:jobs",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_history",
    description: "List recent Flow/History activity for this wallet (no other wallets).",
    scope: "read:jobs",
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
    name: "verify_job",
    description: "Return on-chain receipt fields and the public proof URL for a job this wallet owns.",
    scope: "read:receipts",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", minLength: 8 } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_proof",
    description: "Alias of verify_job — storage root, txs, and proof URL.",
    scope: "read:receipts",
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
    description:
      "Quote then lock+run an Agent Job from the Beacon Safe. The agent never receives the private key. Policy and TeeML still gate spend.",
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
    name: "research",
    description: "Quote then lock+run a research job on 0G Compute within vault limits.",
    scope: "exec:job",
    inputSchema: {
      type: "object",
      properties: { brief: { type: "string", minLength: 8, maxLength: 4000 } },
      required: ["brief"],
      additionalProperties: false,
    },
  },
  {
    name: "quote_swap",
    description: "Live Zia QuoterV2 quote. Does not spend. Thin books are refused.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amount0g: { type: "number", exclusiveMinimum: 0 },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
      },
      required: ["amount0g"],
      additionalProperties: false,
    },
  },
  {
    name: "list_swap_assets",
    description: "Zia-documented tokens with a live factory pool.",
    scope: "exec:swap",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "preflight_tx",
    description: "Deterministic ALLOW/DENY for a vault swap envelope before funds move. Hard rules override the model.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amount0g: { type: "number", exclusiveMinimum: 0 },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
      },
      required: ["amount0g"],
      additionalProperties: false,
    },
  },
  {
    name: "swap",
    description:
      "Beacon vault swap: quote → preflight → policy → Safe → Zia exactInputSingle. amount0g is native 0G in. The agent never receives a private key.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amount0g: { type: "number", exclusiveMinimum: 0 },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
        note: { type: "string", maxLength: 200 },
      },
      required: ["amount0g"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_swap",
    description: "Same as swap — execute a quoted Zia route from the Beacon Safe.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amount0g: { type: "number", exclusiveMinimum: 0 },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
      },
      required: ["amount0g"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect",
    description: "Live Aristotle RPC inspect of an address or transaction hash. No invented ABI.",
    scope: "exec:inspect",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        txHash: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "inspect_wallet",
    description: "Live Aristotle inspect of a wallet or contract address. No invented ABI or token history.",
    scope: "exec:inspect",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_contract",
    description: "Live Aristotle inspect of a contract address. Bytecode and selector hints only — no invented ABI.",
    scope: "exec:inspect",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_transaction",
    description: "Live Aristotle inspect of a transaction hash. Explorer link. No invented logs.",
    scope: "exec:inspect",
    inputSchema: {
      type: "object",
      properties: { txHash: { type: "string" } },
      required: ["txHash"],
      additionalProperties: false,
    },
  },
  {
    name: "bridge",
    description:
      "Live LI.FI quote for USDC Base/Ethereum → 0G. Beacon Safe cannot sign the source chain. Returns the unsigned request.",
    scope: "exec:bridge",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 8, maxLength: 500 },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "quote_bridge",
    description: "Same as bridge — live source-chain quote. Safe cannot sign Base/Ethereum.",
    scope: "exec:bridge",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 8, maxLength: 500 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "track_bridge",
    description:
      "Track a source-chain bridge tx until LI.FI reports DONE with a destination tx. Never complete from the source hash alone. Pass txHash + fromChainId (8453 Base / 1 Ethereum), or a sentence that includes the hash.",
    scope: "exec:bridge",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 8, maxLength: 500 },
        txHash: { type: "string" },
        fromChainId: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "why_denied",
    description: "Explain the last policy or TeeML block for this wallet before funds moved.",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "revoke_agent",
    description: "Revoke this MCP grant immediately. Existing Bearer tokens stop working.",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
