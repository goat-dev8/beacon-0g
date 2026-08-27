import type { McpGrant } from "./grants.js";
import { hasScope, type McpScope } from "./scopes.js";

export type SpendPolicySnapshot = {
  emergencyPause: boolean;
  dailySpend0g: number;
  perJobLimit0g: number;
  spentToday0g: number;
};

export type ToolAuthzResult =
  | { ok: true; amount0g: number }
  | { ok: false; code: string; message: string };

function grantTxCap(grant: McpGrant): number {
  return grant.maxSpendPerTx0g;
}

function grantDailyCap(grant: McpGrant): number {
  return grant.dailyLimit0g;
}

/**
 * Server-side authorization for MCP tool calls.
 * On-chain vault policy remains the final financial boundary for executes.
 */
export function authorizeToolCall(opts: {
  grant: McpGrant;
  neededScope: McpScope;
  amount0g?: number;
  policy: SpendPolicySnapshot;
}): ToolAuthzResult {
  if (!hasScope(opts.grant.scopes, opts.neededScope)) {
    return {
      ok: false,
      code: "SCOPE_DENIED",
      message: `This agent is not allowed to use scope ${opts.neededScope}.`,
    };
  }
  if (opts.policy.emergencyPause) {
    return {
      ok: false,
      code: "SAFE_PAUSED",
      message: "Beacon vault / app policy is paused. Unlock and clear emergency pause first.",
    };
  }

  const amount = Number(opts.amount0g ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Invalid spend amount." };
  }

  if (opts.neededScope.startsWith("exec:") && amount > 0) {
    if (amount > grantTxCap(opts.grant) + 1e-18) {
      return {
        ok: false,
        code: "MCP_TX_LIMIT",
        message: `Agent per-transaction limit is ${grantTxCap(opts.grant)} 0G; requested ${amount}.`,
      };
    }
    if (amount > grantDailyCap(opts.grant) + 1e-18) {
      return {
        ok: false,
        code: "MCP_DAILY_LIMIT",
        message: `Agent daily limit is ${grantDailyCap(opts.grant)} 0G; requested ${amount}.`,
      };
    }
    if (amount > opts.policy.perJobLimit0g + 1e-18) {
      return {
        ok: false,
        code: "APP_PER_JOB_LIMIT",
        message: `App per-job limit is ${opts.policy.perJobLimit0g} 0G; requested ${amount}.`,
      };
    }
    const remaining = Math.max(0, opts.policy.dailySpend0g - opts.policy.spentToday0g);
    if (amount > remaining + 1e-18) {
      return {
        ok: false,
        code: "APP_DAILY_LIMIT",
        message: `App daily remaining is ${remaining} 0G; requested ${amount}.`,
      };
    }
  }

  return { ok: true, amount0g: amount };
}

export const BEACON_MCP_INSTRUCTIONS = `You are connected to Beacon MCP on 0G Aristotle (chain 16661). Same rails as the Beacon Flow desk.

Unit of account is native 0G. Do not invent USDT0, FXRP, or Coston2.

Flow map:
- jobs: quote from the 0G Compute Router catalog (neurons → 0G), lock in escrow, TeeML review, then infer/image.
- swap: vault W0G → Bridged USDC via Zia QuoterV2 + SwapRouter only. Tool: swap({ amount0g }). If liquidity is thin, Beacon refuses — do not suggest another venue.
- infer / image: exec:infer and exec:image within caps.
- pause: exec:pause freezes the vault.

Rules:
1. Never ask for private keys / seeds.
2. Never bypass vault policy or MCP scopes.
3. Before spend: get_policy + get_safe.
4. On SCOPE_DENIED / MCP_TX_LIMIT / SAFE_PAUSED — stop and explain.
5. On success, show chainscan.0g.ai and storagescan.0g.ai links from the tool result.
`;
