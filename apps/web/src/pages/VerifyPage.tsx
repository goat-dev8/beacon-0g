import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { explorerAddress, explorerTx, storageScan } from "@/lib/explorers";
import { apiBase } from "@/lib/publicEnv";
import { proofOutcome } from "@/lib/verifyProof";
import { compareReceipts, compareChatIdHash, readReceiptFromRpc, type BrowserReceipt } from "@/lib/onchainReceipt";
import { compareResultHash, resultSha256 } from "@/lib/resultHash";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import "highlight.js/styles/github-dark.css";

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
    quote?: { modelId?: string; lock0gDisplay?: string; quoteHash?: string; provider?: string; verifiability?: string };
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
    feedbackTx?: string | null;
    feedbackIndex?: string | null;
    feedbackClient?: string | null;
    storageRoot?: string | null;
    storageScan?: string | null;
    resultText?: string | null;
    resultSha256?: string | null;
    denial?: string | null;
    createdAt?: string | null;
  } | null;
  identity?: {
    agentId?: string;
    identity?: string;
    reputation?: string;
    owner?: string | null;
    tokenURI?: string | null;
    giveFeedback?: string;
    card?: string;
    explorerIdentity?: string;
    explorerReputation?: string;
    feedbackTx?: string | null;
    feedbackIndex?: string | null;
  };
  provenance?: {
    jobId?: string;
    createdAt?: string;
    modelId?: string;
    provider?: string;
    verifiability?: string;
    catalogHash?: string;
    quoteHash?: string;
    lock0g?: string;
    teeChatId?: string | null;
    recoveredSigner?: string | null;
    expectedSigner?: string | null;
    storageRoot?: string | null;
    resultSha256?: string | null;
    txs?: Record<string, string | null>;
  } | null;
  related?: {
    swaps?: Array<{ title?: string; explorer_url?: string | null; ref_id?: string | null }>;
    bridges?: Array<{ title?: string; explorer_url?: string | null; ref_id?: string | null }>;
  };
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
  const localResultHash = job?.resultText ? resultSha256(job.resultText) : null;
  const resultHash = compareResultHash(localResultHash, job?.resultSha256);
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

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
                Result fingerprint
              </p>
              <p className="mt-2 text-sm" style={{ color: resultHash.match === false ? DANGER : MUTED }}>
                {resultHash.note}
              </p>
              {localResultHash ? (
                <p className="mt-2 break-all font-mono text-[11px]" style={{ color: FAINT }}>
                  sha256 {localResultHash}
                </p>
              ) : null}
              {job?.resultText ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1.5 text-sm"
                    style={{ borderColor: LINE, color: FG }}
                    onClick={() => void navigator.clipboard.writeText(job.resultText ?? "")}
                  >
                    Copy result
                  </button>
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1.5 text-sm"
                    style={{ borderColor: LINE, color: FG }}
                    onClick={() => {
                      const blob = new Blob([job.resultText ?? ""], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `beacon-${(job.id ?? "result").slice(0, 8)}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download .md
                  </button>
                  <button
                    type="button"
                    className="rounded-full border px-3 py-1.5 text-sm"
                    style={{ borderColor: LINE, color: FG }}
                    onClick={() => {
                      const blob = new Blob([job.resultText ?? ""], { type: "text/plain;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `beacon-${(job.id ?? "result").slice(0, 8)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download .txt
                  </button>
                </div>
              ) : null}
            </section>

            {job?.resultText ? (
              <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
                  Result
                </p>
                <div className="mt-3 text-sm" style={{ color: FG }}>
                  <SafeMarkdown
                    text={job.resultText}
                    className="max-w-none overflow-x-auto text-[15px] leading-7 [&_a]:text-[#39e08a] [&_code]:font-mono [&_code]:text-[13px] [&_li]:my-1 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-[#2a312c] [&_pre]:bg-[#0d1117] [&_pre]:p-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#2a312c] [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-[#2a312c] [&_th]:px-2 [&_th]:py-1.5"
                  />
                </div>
              </section>
            ) : null}

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
                Provenance
              </h2>
              <dl className="mt-4 grid gap-4 text-sm">
                <Meta label="Created" value={data?.provenance?.createdAt ?? job?.createdAt} />
                <Meta label="Model" value={data?.provenance?.modelId ?? job?.quote?.modelId} />
                <Meta label="Provider" value={data?.provenance?.provider ?? job?.quote?.provider} />
                <Meta label="Verifiability" value={data?.provenance?.verifiability ?? job?.quote?.verifiability} />
                <HashRow label="Quote hash" value={data?.provenance?.quoteHash ?? job?.quote?.quoteHash} />
                <HashRow label="Catalog hash" value={data?.provenance?.catalogHash} />
                <HashRow label="TEE chat id" value={data?.provenance?.teeChatId ?? job?.tee?.chatId} />
                <HashRow
                  label="Recovered signer"
                  value={data?.provenance?.recoveredSigner ?? job?.tee?.recoveredSigner}
                  href={
                    (data?.provenance?.recoveredSigner ?? job?.tee?.recoveredSigner)
                      ? explorerAddress(data?.provenance?.recoveredSigner ?? job?.tee?.recoveredSigner ?? "")
                      : undefined
                  }
                />
                <HashRow label="Result SHA-256" value={data?.provenance?.resultSha256 ?? job?.resultSha256} />
              </dl>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
              <h2 className="font-display text-lg font-semibold" style={{ color: FG }}>
                Agent identity
              </h2>
              <dl className="mt-4 grid gap-4 text-sm">
                <Meta label="Agent id" value={data?.identity?.agentId} />
                <Meta label="giveFeedback" value={data?.identity?.giveFeedback} />
                <HashRow
                  label="Identity registry"
                  value={data?.identity?.identity}
                  href={data?.identity?.explorerIdentity}
                />
                <HashRow
                  label="Reputation registry"
                  value={data?.identity?.reputation}
                  href={data?.identity?.explorerReputation}
                />
                <HashRow
                  label="Owner"
                  value={data?.identity?.owner}
                  href={data?.identity?.owner ? explorerAddress(data.identity.owner) : undefined}
                />
                <HashRow label="Agent card" value={data?.identity?.card} href={data?.identity?.card} />
                <HashRow
                  label="This job feedback"
                  value={data?.identity?.feedbackTx ?? job?.feedbackTx}
                  href={
                    (data?.identity?.feedbackTx ?? job?.feedbackTx)
                      ? explorerTx(data?.identity?.feedbackTx ?? job?.feedbackTx ?? "")
                      : undefined
                  }
                />
              </dl>
            </section>

            {(data?.related?.swaps?.length || data?.related?.bridges?.length) ? (
              <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
                <h2 className="font-display text-lg font-semibold" style={{ color: FG }}>
                  Related Safe activity
                </h2>
                <p className="mt-2 text-sm" style={{ color: MUTED }}>
                  Recent recorded swaps and bridges for this wallet. Hashes are explorer links — not this job unless they match.
                </p>
                <ul className="mt-3 space-y-2 text-sm">
                  {(data.related?.swaps ?? []).map((row, i) => (
                    <li key={`swap-${i}`}>
                      {row.explorer_url ? (
                        <a href={row.explorer_url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
                          {row.title ?? "Swap"}
                        </a>
                      ) : (
                        <span>{row.title ?? "Swap"}</span>
                      )}
                    </li>
                  ))}
                  {(data.related?.bridges ?? []).map((row, i) => (
                    <li key={`bridge-${i}`}>
                      {row.explorer_url ? (
                        <a href={row.explorer_url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
                          {row.title ?? "Bridge"}
                        </a>
                      ) : (
                        <span>{row.title ?? "Bridge"}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

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
                <HashRow
                  label="Reputation feedback"
                  value={job?.feedbackTx}
                  href={job?.feedbackTx ? explorerTx(job.feedbackTx) : undefined}
                />
                {job?.feedbackIndex && (
                  <Meta
                    label="Feedback index"
                    value={`#${job.feedbackIndex}${job.feedbackClient ? ` · ${job.feedbackClient}` : ""}`}
                  />
                )}
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
