import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { explorerAddress, explorerTx } from "@/lib/explorers";
import { apiBase } from "@/lib/publicEnv";

type OnchainReceipt = {
  storageRoot?: string;
  teeSigner?: string;
  chatIdHash?: string;
  quoteHash?: string;
  allowed?: boolean;
  exists?: boolean;
  recordedAt?: string;
  recorder?: string;
};

type VerifyPayload = {
  chainId: number;
  explorer: string;
  onchain?: OnchainReceipt | null;
  job: {
    id: string;
    status: string;
    quote?: { modelId?: string; lock0gDisplay?: string; quoteHash?: string };
    tee?: { allow?: boolean; reason?: string };
    lockTx?: string | null;
    releaseTx?: string | null;
    refundTx?: string | null;
    storageRoot?: string | null;
    storageScan?: string | null;
    denial?: string | null;
  } | null;
  note?: string | null;
};

export function VerifyPage() {
  const { jobId } = useParams();
  const [data, setData] = useState<VerifyPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const base = apiBase();
    fetch(`${base}/v1/verify/${jobId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<VerifyPayload>;
      })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "verify failed"));
  }, [jobId]);

  const job = data?.job;
  const onchain = data?.onchain ?? null;
  const storageRoot = job?.storageRoot || onchain?.storageRoot || null;
  const storageScan = job?.storageScan || (storageRoot ? `https://storagescan.0g.ai` : null);

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 text-[var(--p-fg,#e8efe9)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text,#39e08a)]">
        Verify on 0G
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">Job proof</h1>
      <p className="mt-2 text-sm text-[var(--p-muted,#9a96a8)]">
        No wallet required. Chain {data?.chainId ?? 16661} · Aristotle. On-chain receipt is
        authoritative.
      </p>
      {err && <p className="mt-6 text-sm text-red-400">{err}</p>}
      {!err && !job && !onchain && (
        <p className="mt-6 text-sm text-[var(--p-muted)]">{data?.note ?? "Loading…"}</p>
      )}
      {(job || onchain) && (
        <dl className="mt-8 grid gap-4 text-sm">
          <Row label="Job" value={job?.id ?? jobId} />
          <Row label="Status" value={job?.status ?? (onchain?.exists ? "on-chain" : undefined)} />
          <Row label="Model" value={job?.quote?.modelId} />
          <Row label="Lock" value={job?.quote?.lock0gDisplay} />
          <Row
            label="Policy"
            value={
              onchain
                ? onchain.allowed
                  ? "ALLOW (registry)"
                  : "DENY (registry)"
                : job?.tee?.allow
                  ? "ALLOW"
                  : job?.tee?.reason
            }
          />
          <Row
            label="Lock tx"
            value={job?.lockTx}
            href={job?.lockTx ? explorerTx(job.lockTx) : undefined}
          />
          <Row
            label="Release tx"
            value={job?.releaseTx}
            href={job?.releaseTx ? explorerTx(job.releaseTx) : undefined}
          />
          <Row
            label="Refund tx"
            value={job?.refundTx}
            href={job?.refundTx ? explorerTx(job.refundTx) : undefined}
          />
          <Row label="Storage root" value={storageRoot} href={storageScan ?? undefined} />
          <Row
            label="TEE signer"
            value={onchain?.teeSigner}
            href={onchain?.teeSigner ? explorerAddress(onchain.teeSigner) : undefined}
          />
          <Row label="Quote hash" value={onchain?.quoteHash ?? job?.quote?.quoteHash} />
          <Row
            label="Recorder"
            value={onchain?.recorder}
            href={onchain?.recorder ? explorerAddress(onchain.recorder) : undefined}
          />
          {job?.denial && <Row label="Denied" value={job.denial} />}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="border-b border-[var(--p-border,#1e2622)] pb-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-muted)]">{label}</dt>
      {href ? (
        <dd className="mt-1 break-all">
          <a className="text-[var(--p-accent-text,#39e08a)] hover:underline" href={href} target="_blank" rel="noreferrer">
            {value}
          </a>
        </dd>
      ) : (
        <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
      )}
    </div>
  );
}
