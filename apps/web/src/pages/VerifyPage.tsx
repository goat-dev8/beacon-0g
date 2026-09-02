import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { explorerAddress, explorerTx, storageScan } from "@/lib/explorers";
import { apiBase } from "@/lib/publicEnv";
import { proofOutcome } from "@/lib/verifyProof";
import { compareReceipts, compareChatIdHash, readReceiptFromRpc, type BrowserReceipt } from "@/lib/onchainReceipt";

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
    tee?: {
      allow?: boolean;
      reason?: string;
      chatId?: string;
      processResponse?: boolean | null;
      eip191Ok?: boolean | null;
      recoveredSigner?: string | null;
      expectedSigner?: string | null;
    };
    lockTx?: string | null;
    releaseTx?: string | null;
    refundTx?: string | null;
    receiptTx?: string | null;
    storageRoot?: string | null;
    storageScan?: string | null;
    denial?: string | null;
  } | null;
  note?: string | null;
};

const BG = "#070908";
const FG = "#f4f6f4";
const MUTED = "#d7ddd8";
const FAINT = "#c5ccc7";
const LINE = "#2a312c";
const CARD = "#101412";
const ACCENT = "#39e08a";
const DANGER = "#ff6b6b";

export function VerifyPage() {
  const { jobId } = useParams();
  const [data, setData] = useState<VerifyPayload | null>(null);
  const [browser, setBrowser] = useState<BrowserReceipt | null>(null);
  const [rpcErr, setRpcErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    readReceiptFromRpc(jobId)
      .then((row) => {
        setBrowser(row);
        setRpcErr(null);
      })
      .catch((e: unknown) => setRpcErr(e instanceof Error ? e.message : "browser eth_call failed"));
  }, [jobId]);

  const job = data?.job;
  const onchain = browser?.exists
    ? {
        storageRoot: browser.storageRoot,
        teeSigner: browser.teeSigner,
        chatIdHash: browser.chatIdHash,
        quoteHash: browser.quoteHash,
        allowed: browser.allowed,
        exists: true,
        recordedAt: browser.recordedAt,
        recorder: browser.recorder,
      }
    : (data?.onchain ?? null);
  const compare = browser ? compareReceipts(data?.onchain ?? null, browser) : null;
  const chatHash = compareChatIdHash(job?.tee?.chatId, browser?.chatIdHash ?? onchain?.chatIdHash);
  const storageRoot = onchain?.storageRoot || job?.storageRoot || null;
  const storageHref = storageRoot ? storageScan(storageRoot) : null;
  const outcome = proofOutcome(job, onchain);
  const statusColor =
    outcome.tone === "ok" ? ACCENT : outcome.tone === "fail" ? DANGER : MUTED;

  const timeline = useMemo(
    () => [
      { label: "Quoted", done: Boolean(job?.quote?.quoteHash || job?.quote?.lock0gDisplay) },
      { label: "Policy / TeeML", done: Boolean(job?.tee || onchain) },
      { label: "Escrow locked", done: Boolean(job?.lockTx) },
      { label: "Compute", done: Boolean(job?.status && !["QUOTED", "AUTHORIZED"].includes(job.status)) },
      { label: "Storage", done: Boolean(storageRoot) },
      {
        label: job?.refundTx ? "Refunded" : "Released",
        done: Boolean(job?.releaseTx || job?.refundTx),
      },
      { label: "On-chain receipt", done: Boolean(onchain?.exists) },
    ],
    [job, onchain, storageRoot],
  );

  async function copyReceipt() {
    const payload = {
      jobId: job?.id ?? jobId,
      status: outcome.label,
      onchain,
      independentRpc: browser,
      compare,
      lockTx: job?.lockTx,
      releaseTx: job?.releaseTx,
      refundTx: job?.refundTx,
      storageRoot,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="min-h-dvh antialiased" style={{ background: BG, color: FG }}>
      <header className="border-b px-5 py-4" style={{ borderColor: LINE }}>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
            Verified on 0G
          </p>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link className="rounded-full border px-3 py-1.5" style={{ borderColor: LINE, color: FG }} to="/flow">
              Flow
            </Link>
            <Link
              className="rounded-full border px-3 py-1.5"
              style={{ borderColor: LINE, color: FG }}
              to={jobId ? `/flow/desk?job=${jobId}` : "/flow/desk"}
            >
              Jobs
            </Link>
            <Link className="rounded-full px-3 py-1.5 font-medium" style={{ background: ACCENT, color: "#06130c" }} to="/">
              Home
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: ACCENT }}>
          Forensic receipt · Aristotle {data?.chainId ?? 16661}
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl" style={{ color: FG }}>
          Job proof
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: MUTED }}>
          No wallet required. The receipt registry on chain is authoritative — API fields alone are
          not a pass.
        </p>

        {err && (
          <p className="mt-6 text-sm" style={{ color: DANGER }}>
            {err}
          </p>
        )}
        {!err && !job && !onchain && (
          <p className="mt-6 text-sm" style={{ color: MUTED }}>
            {data?.note ?? "Loading…"}
          </p>
        )}

        {(job || onchain) && (
          <div className="mt-8 space-y-6">
            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
                Status
              </p>
              <p className="mt-2 font-display text-3xl font-extrabold" style={{ color: statusColor }}>
                {outcome.label}
              </p>
              <p className="mt-2 break-all font-mono text-xs" style={{ color: MUTED }}>
                {job?.id ?? jobId}
              </p>
              {outcome.verifiedOnChain ? (
                <p className="mt-3 text-sm font-medium" style={{ color: ACCENT }}>
                  Verified on 0G — registry record exists
                </p>
              ) : (
                <p className="mt-3 text-sm" style={{ color: MUTED }}>
                  No registry row yet. Explorer txs below are still the source of truth for lock /
                  release / refund.
                </p>
              )}
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
                Independent RPC
              </p>
              <p className="mt-2 text-sm" style={{ color: compare?.match === false ? DANGER : MUTED }}>
                {rpcErr
                  ? `Browser eth_call failed: ${rpcErr}. API fields alone are not a pass.`
                  : compare?.note ?? "Calling evmrpc.0g.ai from this page…"}
              </p>
              {browser?.jobKey ? (
                <p className="mt-2 break-all font-mono text-[11px]" style={{ color: FAINT }}>
                  receipts({browser.jobKey})
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
                Independent TEE hash
              </p>
              <p className="mt-2 text-sm" style={{ color: chatHash.match === false ? DANGER : MUTED }}>
                {chatHash.note}
              </p>
              <p className="mt-2 text-sm" style={{ color: MUTED }}>
                processResponse {job?.tee?.processResponse == null ? "—" : String(job.tee.processResponse)} · EIP-191{" "}
                {job?.tee?.eip191Ok == null ? "—" : String(job.tee.eip191Ok)}. API TEE flags are not a pass; the
                registry row is.
              </p>
              {job?.tee?.recoveredSigner ? (
                <p className="mt-2 break-all font-mono text-[11px]" style={{ color: FAINT }}>
                  recovered {job.tee.recoveredSigner}
                  {onchain?.teeSigner ? ` · registry ${onchain.teeSigner}` : ""}
                </p>
              ) : null}
            </section>

            <section>
              <h2 className="font-display text-lg font-semibold" style={{ color: FG }}>
                Execution
              </h2>
              <ol className="mt-3 space-y-2">
                {timeline.map((step) => (
                  <li key={step.label} className="flex items-center gap-3 text-sm">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: step.done ? ACCENT : LINE }}
                    />
                    <span style={{ color: step.done ? FG : MUTED }}>{step.label}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <h2 className="font-display text-lg font-semibold" style={{ color: FG }}>
                Financials
              </h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <Meta label="Quoted / locked" value={job?.quote?.lock0gDisplay} />
                <Meta label="Model" value={job?.quote?.modelId} />
                <Meta
                  label="Policy"
                  value={
                    onchain
                      ? onchain.allowed
                        ? "ALLOW (on-chain registry)"
                        : "DENY (on-chain registry)"
                      : job?.tee?.allow
                        ? "TeeML ALLOW claimed by API — not on-chain yet"
                        : job?.tee?.reason || job?.denial
                  }
                  tone={onchain?.allowed ? "ok" : job?.denial ? "fail" : undefined}
                />
                {job?.denial && <Meta label="Denied" value={job.denial} tone="fail" />}
              </dl>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <h2 className="font-display text-lg font-semibold" style={{ color: FG }}>
                Proof
              </h2>
              <dl className="mt-4 grid gap-4 text-sm">
                <HashRow label="Lock tx" value={job?.lockTx} href={job?.lockTx ? explorerTx(job.lockTx) : undefined} />
                <HashRow
                  label="Release tx"
                  value={job?.releaseTx}
                  href={job?.releaseTx ? explorerTx(job.releaseTx) : undefined}
                />
                <HashRow
                  label="Refund tx"
                  value={job?.refundTx}
                  href={job?.refundTx ? explorerTx(job.refundTx) : undefined}
                />
                <HashRow
                  label="Receipt tx"
                  value={job?.receiptTx}
                  href={job?.receiptTx ? explorerTx(job.receiptTx) : undefined}
                />
                <HashRow label="Storage root" value={storageRoot} href={storageHref ?? undefined} />
                <HashRow
                  label="TEE signer"
                  value={onchain?.teeSigner}
                  href={onchain?.teeSigner ? explorerAddress(onchain.teeSigner) : undefined}
                />
                <HashRow label="Quote hash" value={onchain?.quoteHash ?? job?.quote?.quoteHash} />
                <HashRow
                  label="Recorder"
                  value={onchain?.recorder}
                  href={onchain?.recorder ? explorerAddress(onchain.recorder) : undefined}
                />
              </dl>
            </section>

            <section className="flex flex-wrap gap-2">
              <Link
                className="rounded-full px-4 py-2 text-sm font-medium"
                style={{ background: ACCENT, color: "#06130c" }}
                to={jobId ? `/flow/desk?job=${jobId}` : "/flow/desk"}
              >
                Open job
              </Link>
              {job?.lockTx && (
                <a
                  className="rounded-full border px-4 py-2 text-sm"
                  style={{ borderColor: LINE, color: FG }}
                  href={explorerTx(job.lockTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open lock on explorer
                </a>
              )}
              {job?.releaseTx && (
                <a
                  className="rounded-full border px-4 py-2 text-sm"
                  style={{ borderColor: LINE, color: FG }}
                  href={explorerTx(job.releaseTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open release
                </a>
              )}
              {storageHref && (
                <a
                  className="rounded-full border px-4 py-2 text-sm"
                  style={{ borderColor: LINE, color: FG }}
                  href={storageHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open storage proof
                </a>
              )}
              <button
                type="button"
                className="rounded-full border px-4 py-2 text-sm"
                style={{ borderColor: LINE, color: FG }}
                onClick={() => void copyReceipt()}
              >
                {copied ? "Copied" : "Copy receipt"}
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Meta({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string | null;
  tone?: "ok" | "fail";
}) {
  if (!value) return null;
  const color = tone === "ok" ? ACCENT : tone === "fail" ? DANGER : FG;
  return (
    <div className="border-b pb-3" style={{ borderColor: LINE }}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
        {label}
      </dt>
      <dd className="mt-1 break-all text-base font-medium" style={{ color }}>
        {value}
      </dd>
    </div>
  );
}

function HashRow({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="border-b pb-3" style={{ borderColor: LINE }}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
        {label}
      </dt>
      {href ? (
        <dd className="mt-1 break-all">
          <a className="text-sm hover:underline" style={{ color: ACCENT }} href={href} target="_blank" rel="noreferrer">
            {value}
          </a>
        </dd>
      ) : (
        <dd className="mt-1 break-all font-mono text-xs" style={{ color: FG }}>
          {value}
        </dd>
      )}
    </div>
  );
}
