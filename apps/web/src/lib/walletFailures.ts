/** Map wallet / RPC / API failures to honest user copy. Never invent a success. */

export type ExecutionFailureKind =
  | "user_rejected"
  | "wrong_network"
  | "insufficient_balance"
  | "insufficient_gas"
  | "quote_expired"
  | "policy_denied"
  | "tee_denied"
  | "compute_failed"
  | "storage_failed"
  | "thin_book"
  | "bridge_pending"
  | "unknown";

export function classifyExecutionFailure(err: unknown): { kind: ExecutionFailureKind; message: string } {
  const code =
    err && typeof err === "object" && "code" in err ? Number((err as { code: unknown }).code) : undefined;
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "Request failed.");
  const text = raw.toLowerCase();

  if (code === 4001 || /user rejected|rejected the request|denied transaction signature/.test(text)) {
    return { kind: "user_rejected", message: "Wallet rejected the signature. Nothing moved on Aristotle." };
  }
  if (
    code === 4902 ||
    /switch your wallet|unrecognized chain|wrong network|chain 16661|wallet_switchethereumchain/.test(text)
  ) {
    return {
      kind: "wrong_network",
      message: "Wallet is on the wrong network. Beacon jobs and Safe stay on 0G Aristotle (16661).",
    };
  }
  if (/insufficient funds|insufficient balance|exceeds the balance/.test(text)) {
    if (/gas/.test(text)) {
      return { kind: "insufficient_gas", message: "Wallet cannot cover gas. Deposit native 0G, then retry." };
    }
    return {
      kind: "insufficient_balance",
      message: "Balance is too low for this step. Funds were not taken beyond what already confirmed on-chain.",
    };
  }
  if (/offer_expired|quote has expired|expired quote/.test(text)) {
    return { kind: "quote_expired", message: "This quote has expired. Request a new quote to continue." };
  }
  if (/tee_denied|denied by semantic|policy did not allow|would deny/.test(text)) {
    return { kind: "tee_denied", message: raw };
  }
  if (/storage_failed|could not store evidence/.test(text)) {
    return { kind: "storage_failed", message: raw };
  }
  if (/compute_failed|did not return a usable result/.test(text)) {
    return { kind: "compute_failed", message: raw };
  }
  if (/swap_refused|verified liquidity is insufficient|thin book/.test(text)) {
    return { kind: "thin_book", message: raw };
  }
  if (/li\.?fi status is pending|not mark the bridge complete|destination is not complete/.test(text)) {
    return {
      kind: "bridge_pending",
      message: "Source may be confirmed. Destination is complete only when the bridge reports DONE with a 0G tx.",
    };
  }
  if (/blocked before funds|not allowlisted|max_tx/.test(text)) {
    return { kind: "policy_denied", message: raw };
  }
  return { kind: "unknown", message: raw };
}
