import { format0g, parse0g } from "@beacon/shared";

export type SpendJob = {
  id: string;
  status: string;
  lock0g: bigint;
  lockTx?: string | null;
  releaseTx?: string | null;
  refundTx?: string | null;
};

export type SpendActivity = {
  kind: string;
  title: string;
  ref_id?: string | null;
  explorer_url?: string | null;
  meta?: Record<string, unknown> | null;
};

export type SpendLane = {
  id: "escrow" | "safe" | "swap" | "gas";
  label: string;
  amount0g: string;
  note: string;
};

export type SpendReport = {
  lanes: SpendLane[];
  honesty: string;
  jobIds: string[];
  hashes: string[];
};

const HASH = /0x[a-fA-F0-9]{64}/;

export function parseSwapPrincipal(title: string, meta?: Record<string, unknown> | null): bigint {
  const fromMeta = meta?.amountInDisplay ?? meta?.amount;
  if (typeof fromMeta === "string" && fromMeta.trim()) {
    try {
      return parse0g(fromMeta);
    } catch {
      /* fall through */
    }
  }
  const m = title.match(/·\s*(\d+(?:\.\d+)?)/);
  if (!m) return 0n;
  try {
    return parse0g(m[1]);
  } catch {
    return 0n;
  }
}

export function pickProvenJob<T extends { lockTx?: string | null; releaseTx?: string | null; refundTx?: string | null }>(
  jobs: T[],
): T | undefined {
  return jobs.find((j) => Boolean(j.lockTx || j.releaseTx || j.refundTx));
}

export function collectSpendHashes(jobs: SpendJob[], activity: SpendActivity[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw?: string | null) => {
    if (!raw) return;
    const m = raw.match(HASH);
    if (!m) return;
    const h = m[0].toLowerCase();
    if (seen.has(h)) return;
    seen.add(h);
    out.push(m[0]);
  };
  for (const job of jobs) {
    push(job.lockTx);
    push(job.releaseTx);
    push(job.refundTx);
  }
  for (const row of activity) {
    push(row.ref_id);
    push(row.explorer_url);
  }
  return out.slice(0, 24);
}

export function receiptGasWei(receipt: {
  gasUsed?: bigint | null;
  gasPrice?: bigint | null;
  effectiveGasPrice?: bigint | null;
} | null): bigint {
  if (!receipt?.gasUsed) return 0n;
  const price = receipt.effectiveGasPrice ?? receipt.gasPrice ?? 0n;
  return receipt.gasUsed * price;
}

const SETTLED = new Set(["CLOSED", "PASSED", "SETTLING"]);
const OPEN = new Set(["AUTHORIZED", "PREPARING", "GENERATING", "COMPOSING", "ACCEPTING"]);

export function composeSpendReport(input: {
  jobs: SpendJob[];
  windowSpent?: bigint | null;
  activity: SpendActivity[];
  gasWei: bigint;
}): SpendReport {
  let escrowSettled = 0n;
  let escrowOpen = 0n;
  let escrowRefunded = 0n;
  for (const job of input.jobs) {
    if (job.refundTx) {
      escrowRefunded += job.lock0g;
      continue;
    }
    if (SETTLED.has(job.status)) escrowSettled += job.lock0g;
    else if (OPEN.has(job.status)) escrowOpen += job.lock0g;
  }
  const escrow = escrowSettled + escrowOpen;
  let swapPrincipal = 0n;
  for (const row of input.activity) {
    if (row.kind !== "swap") continue;
    swapPrincipal += parseSwapPrincipal(row.title, row.meta);
  }
  const windowSpent = input.windowSpent ?? 0n;

  const lanes: SpendLane[] = [
    {
      id: "escrow",
      label: "Job escrow",
      amount0g: format0g(escrow),
      note: escrowRefunded > 0n
        ? `Settled/open ${format0g(escrow)}. Refunded ${format0g(escrowRefunded)} (not in this lane).`
        : "Native 0G locked in Job Escrow. Not Safe windowSpent.",
    },
    {
      id: "safe",
      label: "Safe window",
      amount0g: format0g(windowSpent),
      note: "Vault rolling window. Includes Zia principal. Do not add to escrow.",
    },
    {
      id: "swap",
      label: "Zia swaps",
      amount0g: format0g(swapPrincipal),
      note: "Slice of Safe window (recorded swaps). Do not add to Safe window.",
    },
    {
      id: "gas",
      label: "Gas (wallet)",
      amount0g: format0g(input.gasWei),
      note: "From live receipts of Beacon txs. Paid by the submitting wallet, not escrow.",
    },
  ];

  return {
    lanes,
    honesty:
      "Four ledgers. Escrow ≠ Safe window ≠ gas. Swap principal is already inside the Safe window — never add swap + Safe.",
    jobIds: input.jobs.map((j) => j.id),
    hashes: collectSpendHashes(input.jobs, input.activity),
  };
}
