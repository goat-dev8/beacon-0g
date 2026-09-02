export type Capability = {
  name: string;
  group: "wallet" | "ai" | "research" | "storage" | "execution" | "defi" | "bridge" | "safety";
  description: string;
  mutates: boolean;
  quote: boolean;
  proof: boolean;
};

/** Only tools that exist in this build. Do not list vapor. */
export const BEACON_CAPABILITIES: Capability[] = [
  { name: "get_safe_balance", group: "wallet", description: "Native 0G + W0G wealth on the Beacon Safe.", mutates: false, quote: false, proof: false },
  { name: "get_policy", group: "wallet", description: "Per-tx and daily spend caps on the Safe.", mutates: false, quote: false, proof: false },
  { name: "inspect_address", group: "research", description: "Live Aristotle bytecode, balance, selector hints. No invented ABI.", mutates: false, quote: false, proof: false },
  { name: "inspect_transaction", group: "research", description: "Live tx status, value, selector, logs. Explorer link.", mutates: false, quote: false, proof: false },
  { name: "generate_image", group: "ai", description: "z-image-turbo on 0G Compute with TeeML policy and Storage root.", mutates: true, quote: true, proof: true },
  { name: "research", group: "ai", description: "Cheapest verified TeeML chat model from the live catalog.", mutates: true, quote: true, proof: true },
  { name: "analysis", group: "ai", description: "RPC inspect, then a cheap TeeML job with that evidence in the brief.", mutates: true, quote: true, proof: true },
  { name: "cheap_model", group: "ai", description: "Requote the last intent on the cheapest verified catalog model.", mutates: true, quote: true, proof: true },
  { name: "verify_job", group: "execution", description: "On-chain receipt registry + lock/release/refund txs.", mutates: false, quote: false, proof: true },
  { name: "list_swap_assets", group: "defi", description: "Zia-documented tokens with a live factory pool and quoter amountOut.", mutates: false, quote: false, proof: false },
  { name: "quote_swap", group: "defi", description: "Zia QuoterV2 exactInput. Thin books refused.", mutates: false, quote: true, proof: false },
  { name: "execute_swap", group: "defi", description: "Safe execute: native 0G or W0G in only. Token→0G quotes live but revert on wealth().", mutates: true, quote: true, proof: true },
  { name: "list_bridge_routes", group: "bridge", description: "Real 0G Hub / get.0g.ai / Zia-documented bridges. Not executable from the Aristotle Safe.", mutates: false, quote: false, proof: false },
  { name: "mcp_grant", group: "execution", description: "Scoped MCP grants in Redis. One wallet signature mints a Bearer token. Tools execute through the Safe; the agent never gets a private key.", mutates: true, quote: false, proof: false },
  { name: "mcp_oauth", group: "execution", description: "OAuth discovery + PKCE authorization_code so an external MCP client can Authenticate without pasting a token.", mutates: false, quote: false, proof: false },
  { name: "preflight_tx", group: "safety", description: "Deterministic ALLOW/DENY of vault call envelopes plus eth_call simulation. Hard DENY overrides any model.", mutates: false, quote: false, proof: false },
  { name: "evidence_memory", group: "research", description: "Recall jobs, swaps, and receipts from History + Storage roots + on-chain txs.", mutates: false, quote: false, proof: true },
  { name: "erc8004_feedback", group: "execution", description: "Official giveFeedback after a real job release or refund. Agent owner cannot self-feedback. Client is a dedicated EOA.", mutates: true, quote: false, proof: true },
  { name: "why_denied", group: "safety", description: "Explain the last policy block before funds moved.", mutates: false, quote: false, proof: false },
];

export function capabilityCard() {
  return {
    type: "capabilities",
    title: "What Beacon can do now",
    groups: BEACON_CAPABILITIES.reduce<Record<string, string[]>>((acc, cap) => {
      acc[cap.group] ??= [];
      acc[cap.group].push(cap.name);
      return acc;
    }, {}),
    items: BEACON_CAPABILITIES,
  };
}
