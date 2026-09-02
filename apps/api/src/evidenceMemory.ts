export type MemoryCitation = {
  kind: string;
  title: string;
  createdAt?: string | null;
  explorer?: string | null;
  verify?: string | null;
  storageRoot?: string | null;
  receiptTx?: string | null;
  refId?: string | null;
};

export type MemoryRecord = {
  answer: string;
  citations: MemoryCitation[];
  windowDays: number;
  source: "history+jobs+receipts";
};

export type MemoryJob = {
  id: string;
  status: string;
  createdAt: string;
  brief?: string;
  storageRoot?: string | null;
  lockTx?: string | null;
  releaseTx?: string | null;
  refundTx?: string | null;
  receiptTx?: string | null;
  quote?: { modelId?: string; lock0gDisplay?: string };
};

export type MemoryActivity = {
  kind?: string;
  title?: string;
  created_at?: string;
  explorer_url?: string | null;
  ref_id?: string | null;
  meta?: Record<string, unknown> | null;
};

function inWindow(iso: string | undefined, cutoffMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= cutoffMs;
}

function daysFromQuestion(question: string): number {
  const q = question.toLowerCase();
  if (/\btoday\b|last 24/.test(q)) return 1;
  if (/30 days|last month/.test(q)) return 30;
  return 7;
}

/**
 * Evidence-backed recall. Does not invent events. Empty evidence → empty citations.
 */
export function recallEvidence(input: {
  question: string;
  jobs: MemoryJob[];
  activity: MemoryActivity[];
  nowMs?: number;
}): MemoryRecord {
  const windowDays = daysFromQuestion(input.question);
  const cutoff = (input.nowMs ?? Date.now()) - windowDays * 86_400_000;
  const citations: MemoryCitation[] = [];

  for (const job of input.jobs) {
    if (!inWindow(job.createdAt, cutoff)) continue;
    citations.push({
      kind: "job",
      title: `${job.status} · ${job.quote?.modelId ?? "job"} · ${job.quote?.lock0gDisplay ?? ""}`.trim(),
      createdAt: job.createdAt,
      explorer: job.releaseTx
        ? `https://chainscan.0g.ai/tx/${job.releaseTx}`
        : job.refundTx
          ? `https://chainscan.0g.ai/tx/${job.refundTx}`
          : job.lockTx
            ? `https://chainscan.0g.ai/tx/${job.lockTx}`
            : null,
      verify: `/verify/${job.id}`,
      storageRoot: job.storageRoot ?? null,
      receiptTx: job.receiptTx ?? null,
      refId: job.id,
    });
  }

  for (const row of input.activity) {
    if (!inWindow(row.created_at, cutoff)) continue;
    const meta = row.meta ?? {};
    const storageRoot = typeof meta.storageRoot === "string" ? meta.storageRoot : null;
    citations.push({
      kind: row.kind || "activity",
      title: row.title || row.kind || "activity",
      createdAt: row.created_at ?? null,
      explorer: row.explorer_url ?? null,
      verify: row.ref_id && /^[0-9a-f-]{36}$/i.test(row.ref_id) ? `/verify/${row.ref_id}` : null,
      storageRoot,
      receiptTx: typeof meta.receiptTx === "string" ? meta.receiptTx : null,
      refId: row.ref_id ?? null,
    });
  }

  const jobsN = citations.filter((c) => c.kind === "job").length;
  const swapsN = citations.filter((c) => c.kind === "swap").length;
  const proven = citations.filter((c) => c.storageRoot || c.receiptTx || c.explorer).length;
  const answer = citations.length
    ? `In the last ${windowDays} day(s) Beacon has ${citations.length} evidence-backed record(s): ${jobsN} job(s), ${swapsN} swap(s). ${proven} cite an explorer tx, Storage root, or on-chain receipt. Open a citation to verify — this answer is not a substitute for /verify.`
    : `No History, job, or receipt evidence is on file for this wallet in the last ${windowDays} day(s). Beacon will not invent a memory.`;

  return {
    answer,
    citations: citations.slice(0, 24),
    windowDays,
    source: "history+jobs+receipts",
  };
}
