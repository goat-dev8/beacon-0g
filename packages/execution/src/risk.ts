export type RiskTier = "AUTO" | "CONFIRM" | "BLOCK";

export type RiskFactor = {
  code: string;
  detail: string;
  severity: "info" | "confirm" | "block";
};

export type RiskDecision = {
  tier: RiskTier;
  needsHuman: boolean;
  reason: string;
  factors: RiskFactor[];
};

export type RiskInput = {
  amountWei: bigint | string | number;
  autoMaxWei?: bigint | string | number;
  impactBps?: number;
  knownPair?: boolean;
  knownTarget?: boolean;
  knownSelector?: boolean;
  isBridge?: boolean;
  newProtocol?: boolean;
  unusualAsset?: boolean;
  outOfPattern?: boolean;
  paused?: boolean;
};

function asBig(value: bigint | string | number | undefined): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const t = value.trim();
  if (!t) return 0n;
  return BigInt(t);
}

/** 0.05 native 0G. Known Zia pairs at or under this stay autonomous. */
export const AUTO_SWAP_WEI = 5n * 10n ** 16n;

/**
 * Deterministic risk gate. Hard BLOCK always wins.
 * CONFIRM asks a human in Flow. Unattended MCP may still run AUTO envelopes.
 */
export function classifyRisk(input: RiskInput): RiskDecision {
  const factors: RiskFactor[] = [];
  const amount = asBig(input.amountWei);
  const autoMax = input.autoMaxWei === undefined ? AUTO_SWAP_WEI : asBig(input.autoMaxWei);

  if (input.paused) {
    factors.push({ code: "paused", detail: "Safe is paused", severity: "block" });
  }
  if (input.knownTarget === false) {
    factors.push({ code: "unknown_target", detail: "Target is not on the allowlist", severity: "block" });
  }
  if (input.knownSelector === false) {
    factors.push({ code: "unknown_selector", detail: "Selector is not on the allowlist", severity: "block" });
  }
  if (input.isBridge) {
    factors.push({
      code: "bridge",
      detail: "Bridge requires a source-chain signature; Beacon Safe cannot execute it",
      severity: "confirm",
    });
  }
  if (input.newProtocol) {
    factors.push({ code: "new_protocol", detail: "Protocol is not in the live allowlist", severity: "confirm" });
  }
  if (input.unusualAsset) {
    factors.push({ code: "unusual_asset", detail: "Asset is not a quoted Zia pair", severity: "confirm" });
  }
  if (input.knownPair === false) {
    factors.push({ code: "unknown_pair", detail: "Pair is not a live Zia factory pool", severity: "confirm" });
  }
  if (typeof input.impactBps === "number" && input.impactBps > 300) {
    factors.push({
      code: "slippage",
      detail: `Quoted impact ${input.impactBps} bps exceeds 300`,
      severity: input.impactBps > 800 ? "block" : "confirm",
    });
  }
  if (amount > autoMax) {
    factors.push({
      code: "high_value",
      detail: `Amount ${amount} exceeds autonomous envelope ${autoMax}`,
      severity: "confirm",
    });
  }
  if (input.outOfPattern) {
    factors.push({
      code: "out_of_pattern",
      detail: "Spend is far above recent activity for this wallet",
      severity: "confirm",
    });
  }

  const blocked = factors.filter((f) => f.severity === "block");
  if (blocked.length > 0) {
    return {
      tier: "BLOCK",
      needsHuman: true,
      reason: blocked.map((f) => `${f.code}: ${f.detail}`).join("; "),
      factors,
    };
  }
  const confirms = factors.filter((f) => f.severity === "confirm");
  if (confirms.length > 0) {
    return {
      tier: "CONFIRM",
      needsHuman: confirms.some((f) => f.code !== "high_value"),
      reason: confirms.map((f) => `${f.code}: ${f.detail}`).join("; "),
      factors,
    };
  }
  return {
    tier: "AUTO",
    needsHuman: false,
    reason: "Inside the autonomous envelope.",
    factors,
  };
}
