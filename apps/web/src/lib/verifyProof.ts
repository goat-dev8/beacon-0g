export type ProofJob = {
  id?: string;
  status?: string;
  lockTx?: string | null;
  releaseTx?: string | null;
  refundTx?: string | null;
  storageRoot?: string | null;
  denial?: string | null;
};

export type ProofOnchain = {
  exists?: boolean;
  allowed?: boolean;
  storageRoot?: string;
} | null;

export type ProofTone = "ok" | "fail" | "warn" | "neutral";

export function proofOutcome(job: ProofJob | null, onchain: ProofOnchain): {
  label: string;
  tone: ProofTone;
  verifiedOnChain: boolean;
} {
  const verifiedOnChain = Boolean(onchain?.exists);
  if (job?.refundTx) {
    return { label: "REFUNDED", tone: "fail", verifiedOnChain };
  }
  if (job?.denial && !job.releaseTx) {
    return { label: "DENIED", tone: "fail", verifiedOnChain };
  }
  if (job?.status === "CLOSED" && job.releaseTx && verifiedOnChain && onchain?.allowed) {
    return { label: "SUCCESS", tone: "ok", verifiedOnChain: true };
  }
  if (job?.status === "CLOSED" && job.releaseTx) {
    return { label: "SETTLED", tone: "ok", verifiedOnChain };
  }
  if (job?.status === "FAILED") {
    return { label: "FAILED", tone: "fail", verifiedOnChain };
  }
  if (verifiedOnChain) {
    return {
      label: onchain?.allowed ? "ON-CHAIN ALLOW" : "ON-CHAIN DENY",
      tone: onchain?.allowed ? "ok" : "fail",
      verifiedOnChain: true,
    };
  }
  return { label: job?.status ?? "UNKNOWN", tone: "neutral", verifiedOnChain: false };
}

export function jobIdFromDeskHref(href: string): string | null {
  const match = href.match(/[?&]job=([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}
