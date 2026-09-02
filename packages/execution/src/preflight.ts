import { hashImmutableInput } from "./hash.js";

export const SELECTOR_WETH_DEPOSIT = "0xd0e30db0";
export const SELECTOR_ERC20_APPROVE = "0x095ea7b3";
export const SELECTOR_EXACT_INPUT_SINGLE = "0x414bf389";

export type PreflightCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type PreflightDecision = {
  verdict: "ALLOW" | "DENY";
  reason: string;
  checks: PreflightCheck[];
  intentHash: string;
};

export type PreflightCall = {
  target: string;
  data: string;
  value?: bigint | string | number;
  maxSpend?: bigint | string | number;
};

function asBig(value: bigint | string | number | undefined): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const t = value.trim();
  if (!t) return 0n;
  return BigInt(t);
}

function normAddr(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function selectorOf(data: string): string {
  const hex = data.trim().toLowerCase();
  if (!hex.startsWith("0x") || hex.length < 10) return "";
  return hex.slice(0, 10);
}

function paddedAddressInData(data: string, address: string): boolean {
  const addr = normAddr(address).replace(/^0x/, "");
  if (addr.length !== 40) return false;
  return data.toLowerCase().includes(addr.padStart(64, "0"));
}

function add(
  checks: PreflightCheck[],
  name: string,
  ok: boolean,
  detail: string,
): void {
  checks.push({ name, ok, detail });
}

/**
 * Deterministic vault-call gate. Hard DENY overrides any model suggestion.
 * Does not simulate chain state; callers should quote live before this.
 */
export function preflightVaultCalls(input: {
  calls: PreflightCall[];
  safe: string;
  paused: boolean;
  maxSpendPolicyWei: bigint | string | number;
  allowedTargets: string[];
  allowedSelectors?: string[];
  w0g: string;
  router: string;
  quotedMinOut?: bigint | string | number;
  deadlineSeconds?: number;
  nowSeconds?: number;
  seenNonces?: Iterable<string>;
  nonce?: bigint | string | number;
  simulationOk?: boolean;
  simulationDetail?: string;
}): PreflightDecision {
  const checks: PreflightCheck[] = [];
  const allowedTargets = new Set(input.allowedTargets.map(normAddr));
  const allowedSelectors = new Set(
    (input.allowedSelectors ?? [
      SELECTOR_WETH_DEPOSIT,
      SELECTOR_ERC20_APPROVE,
      SELECTOR_EXACT_INPUT_SINGLE,
    ]).map((s) => s.toLowerCase()),
  );
  const safe = normAddr(input.safe);
  const w0g = normAddr(input.w0g);
  const router = normAddr(input.router);
  const policy = asBig(input.maxSpendPolicyWei);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  add(checks, "paused", !input.paused, input.paused ? "Safe is paused" : "Safe is active");
  add(checks, "safe", /^0x[0-9a-f]{40}$/.test(safe), safe ? `Safe ${safe}` : "Safe address missing");
  add(checks, "calls", input.calls.length > 0, `${input.calls.length} call(s)`);

  const seen = new Set(Array.from(input.seenNonces ?? []).map(String));
  if (input.nonce !== undefined) {
    const n = asBig(input.nonce).toString();
    add(checks, "nonce", n !== "0" && !seen.has(n), seen.has(n) ? "Nonce already used" : `Nonce ${n}`);
  }

  if (input.deadlineSeconds !== undefined) {
    add(
      checks,
      "deadline",
      input.deadlineSeconds > now,
      input.deadlineSeconds > now ? `Deadline ${input.deadlineSeconds}` : "Deadline already passed",
    );
  }

  if (input.quotedMinOut !== undefined) {
    const minOut = asBig(input.quotedMinOut);
    add(checks, "slippage", minOut > 0n, minOut > 0n ? `minOut ${minOut}` : "minOut is 0");
  }

  for (const [i, call] of input.calls.entries()) {
    const target = normAddr(call.target);
    const selector = selectorOf(call.data);
    const value = asBig(call.value);
    const maxSpend = asBig(call.maxSpend);
    add(checks, `target:${i}`, allowedTargets.has(target), `target ${target || "(empty)"}`);
    add(checks, `selector:${i}`, allowedSelectors.has(selector), `selector ${selector || "(empty)"}`);
    add(checks, `policy:${i}`, maxSpend <= policy, `maxSpend ${maxSpend} vs policy ${policy}`);

    if (selector === SELECTOR_WETH_DEPOSIT) {
      add(checks, `wrap-target:${i}`, target === w0g, "deposit must target W0G");
      add(checks, `wrap-value:${i}`, value > 0n, "deposit must send native value");
    } else {
      add(checks, `value:${i}`, value === 0n, "non-wrap calls must send value 0");
    }

    if (selector === SELECTOR_ERC20_APPROVE) {
      add(checks, `approve-target:${i}`, target === w0g, "approve must target W0G");
      add(checks, `approve-spender:${i}`, paddedAddressInData(call.data, router), "approve spender must be the Zia router");
    }

    if (selector === SELECTOR_EXACT_INPUT_SINGLE) {
      add(checks, `swap-target:${i}`, target === router, "swap must target the Zia router");
      add(checks, `destination:${i}`, paddedAddressInData(call.data, safe), "swap recipient must be the Beacon Safe");
    }
  }

  if (input.simulationOk !== undefined) {
    add(
      checks,
      "simulation",
      input.simulationOk,
      input.simulationDetail ?? (input.simulationOk ? "eth_call succeeded" : "eth_call reverted"),
    );
  }

  const failed = checks.filter((c) => !c.ok);
  const intentHash = hashImmutableInput({
    safe,
    paused: input.paused,
    calls: input.calls.map((c) => ({
      target: normAddr(c.target),
      selector: selectorOf(c.data),
      value: asBig(c.value).toString(),
      maxSpend: asBig(c.maxSpend).toString(),
    })),
  });
  if (failed.length > 0) {
    return {
      verdict: "DENY",
      reason: failed.map((c) => `${c.name}: ${c.detail}`).join("; "),
      checks,
      intentHash,
    };
  }
  return { verdict: "ALLOW", reason: "All hard preflight checks passed.", checks, intentHash };
}
