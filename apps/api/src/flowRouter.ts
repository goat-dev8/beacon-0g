export type FlowLane = "inline" | "job" | "transaction" | "deny";

export type FlowKind =
  | "deny_unconstrained"
  | "why_blocked"
  | "balance"
  | "catalog"
  | "swap_assets"
  | "swap_quote"
  | "bridge_info"
  | "bridge_quote"
  | "inspect_tx"
  | "inspect_address"
  | "spend"
  | "verify"
  | "erc8004"
  | "cheap_model"
  | "image_job"
  | "research_job"
  | "analysis_job"
  | "unknown";

export type FlowClassification = {
  lane: FlowLane;
  kind: FlowKind;
};

const TX_HASH = /0x[a-fA-F0-9]{64}/;
const ADDR = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/;

/** Paid TeeML explanation — not a live RPC inspect. */
export function wantsPaidExplanation(raw: string): boolean {
  return /\bexplain\b|\banalyze\b|paid (explanation|interpretation)|deep (read|dive)/.test(
    raw.toLowerCase(),
  );
}

/**
 * Typed Flow router. Lightweight reads stay INLINE. Heavy work is JOB.
 * Swaps/bridges that need a signature are TRANSACTION. Unconstrained sends DENY.
 */
export function classifyFlowIntent(raw: string): FlowClassification {
  const text = raw.toLowerCase();

  if (/5\s*0g|send .*0g to 0x/.test(text) && /random|this address|0x/.test(text)) {
    return { lane: "deny", kind: "deny_unconstrained" };
  }
  if (/why (was (this |i |that )?|is (this |it )?)?(block|denied)|show me why that was blocked/.test(text)) {
    return { lane: "inline", kind: "why_blocked" };
  }
  if (/verify/.test(text) && /last|proof|receipt|result/.test(text)) {
    return { lane: "inline", kind: "verify" };
  }
  if (/what can (beacon|you) do|capabilities|what can i do/.test(text)) {
    return { lane: "inline", kind: "catalog" };
  }
  if (/what can i swap|swap assets|what assets can i swap|what tokens can i swap/.test(text)) {
    return { lane: "inline", kind: "swap_assets" };
  }
  if (/\bbridge\b/.test(text) && /\d/.test(text) && /base|ethereum|eth\b|bnb|bsc/.test(text)) {
    return { lane: "transaction", kind: "bridge_quote" };
  }
  if (/\bbridge\b/.test(text)) {
    return { lane: "inline", kind: "bridge_info" };
  }
  if (/erc-?8004|givefeedback|agent (identity|reputation|feedback)/.test(text)) {
    return { lane: "inline", kind: "erc8004" };
  }
  if (TX_HASH.test(raw) && /inspect|analyze|explain|transaction|\btx\b/.test(text)) {
    if (wantsPaidExplanation(raw)) return { lane: "job", kind: "analysis_job" };
    return { lane: "inline", kind: "inspect_tx" };
  }
  if (
    (ADDR.test(raw) || /analyze this wallet|inspect my (wallet|safe)|analyze my (wallet|safe)|inspect this wallet/.test(text)) &&
    /inspect|analyze|explain|contract|wallet|address/.test(text)
  ) {
    if (wantsPaidExplanation(raw)) return { lane: "job", kind: "analysis_job" };
    return { lane: "inline", kind: "inspect_address" };
  }
  if (/safe balance|how much .*(safe|wealth)|what('?s| is) (in )?my safe|policy window/.test(text)) {
    return { lane: "inline", kind: "balance" };
  }
  if (/what did i spend|show what the last job cost|spend(ing)? summary|cost today|how much did i spend/.test(text)) {
    return { lane: "inline", kind: "spend" };
  }
  if (/\bswap\b|\bconvert\b|usdc\.?e|wbtc|st0g/.test(text) && /\d/.test(text)) {
    return { lane: "transaction", kind: "swap_quote" };
  }
  if (/cheap(er|est)?/.test(text)) {
    return { lane: "job", kind: "cheap_model" };
  }
  if (/image|lighthouse|picture|draw/.test(text)) {
    return { lane: "job", kind: "image_job" };
  }
  if (/research|document|long (report|brief)/.test(text)) {
    return { lane: "job", kind: "research_job" };
  }
  return { lane: "job", kind: "unknown" };
}
