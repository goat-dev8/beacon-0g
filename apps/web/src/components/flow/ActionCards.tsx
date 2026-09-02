import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { NETWORK } from "@/lib/chain";
import { explorerTx } from "@/lib/explorers";
import { jobIdFromDeskHref } from "@/lib/verifyProof";
import { cn } from "@/lib/utils";
import { ensureSafeAgentSession } from "@/lib/safeSession";
import { executeLifiBridge } from "@/lib/wallet";
import { classifyExecutionFailure } from "@/lib/walletFailures";
import { jobPipeline, jobPhaseFromStatus, swapQuoteExpired } from "@/lib/quoteFreshness";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import type { CardExecutionState, AgentCard } from "@/lib/executionPhases";
import type { ConvState, PaidResendMeta } from "@/lib/flowTypes";

type SpendLane = { id: string; label: string; amount0g: string; note: string };

function SpendBreakdownCard({ card }: { card: AgentCard }) {
  const windows = card.windows as Record<string, { lanes?: SpendLane[] }> | undefined;
  const fallback = Array.isArray(card.lanes) ? (card.lanes as SpendLane[]) : [];
  const [win, setWin] = useState<"1d" | "7d" | "30d">("1d");
  const lanes = windows?.[win]?.lanes ?? fallback;
  return (
    <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
        {String(card.title ?? "Spend ledgers")}
      </p>
      {windows ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["1d", "Today"],
              ["7d", "7d"],
              ["30d", "30d"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWin(id)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider",
                win === id
                  ? "bg-signal text-ink"
                  : "border border-[var(--p-border)] text-[var(--p-muted)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {lanes.map((lane) => (
          <div key={lane.id} className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">{lane.label}</p>
            <p className="font-display text-lg text-[var(--p-fg)]">{lane.amount0g}</p>
            <p className="mt-1 text-xs text-[var(--p-muted)]">{lane.note}</p>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-amber-200/90">{String(card.honesty ?? "")}</p>
    </div>
  );
}

function FccHardwareStrip({ card }: { card: AgentCard }) {
  const status = card.teeSignedStatus;
  if (typeof status !== "number") return null;
  const allowed = status === 1;
  const href = typeof card.fccExplorer === "string" ? card.fccExplorer : null;
  const log = typeof card.fccLog === "string" ? card.fccLog : null;
  return (
    <div
      className={cn(
        "mt-3 rounded-xl border px-3 py-2 font-mono text-[11px]",
        allowed
          ? "border-signal/40 bg-signal/10 text-[var(--p-accent-text)]"
          : "border-[var(--p-danger)]/40 bg-[var(--p-danger)]/10 text-[var(--p-danger)]",
      )}
    >
      <p className="uppercase tracking-widest">
        Hardware TEE · {allowed ? "ALLOW status 1" : "DENY status 0"}
      </p>
      {card.amountUsdt0 != null && card.amountCapUsdt0 != null ? (
        <p className="mt-1 text-[var(--p-muted)]">
          {String(card.amountUsdt0)} 0G vs cap {String(card.amountCapUsdt0)}
        </p>
      ) : null}
      {log ? <p className="mt-1 text-[var(--p-muted)]">{log}</p> : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 underline underline-offset-2"
        >
          Open TeeML proof <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

export function ActionCard({
  card,
  cardKey: execKey,
  wallet,
  convState: _convState,
  settledServiceIds: _settledServiceIds,
  savedExec,
  onExecutionStateChange,
  onConnect,
  onBalancesRefresh,
  onTxConfirmed,
  onQuickReply,
}: {
  card: AgentCard;
  cardKey: string;
  wallet: string | null;
  convState: ConvState;
  settledServiceIds: Set<string>;
  savedExec?: CardExecutionState;
  onExecutionStateChange: (key: string, state: CardExecutionState) => void;
  onConnect: () => void;
  onMint: () => void;
  onPaidResend: (payment: Record<string, unknown>, meta: PaidResendMeta) => void;
  onBalancesRefresh: () => void;
  onTxConfirmed?: (info: {
    kind: "swap" | "bridge" | "proof";
    title: string;
    hash: string;
    explorerUrl: string;
    meta?: Record<string, unknown>;
  }) => void;
  onQuickReply: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveStatus, setApproveStatus] = useState<"idle" | "pending" | "confirmed" | "skipped" | "failed">(
    () => savedExec?.approveStatus ?? "idle",
  );
  const [swapStatus, setSwapStatus] = useState<"idle" | "pending" | "confirmed" | "failed">(
    () => savedExec?.swapStatus ?? "idle",
  );
  const [approveHash, setApproveHash] = useState<string | null>(() => savedExec?.approveHash ?? null);
  const [swapHash, setSwapHash] = useState<string | null>(() => savedExec?.swapHash ?? null);
  const [sendStatus, setSendStatus] = useState<"idle" | "pending" | "confirmed" | "failed">(
    () => savedExec?.sendStatus ?? "idle",
  );
  const [sendHash, setSendHash] = useState<string | null>(() => savedExec?.sendHash ?? null);
  const [jobPhase, setJobPhase] = useState<"idle" | "locking" | "running" | "done" | "failed">("idle");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<string | null>(null);
  const [jobImage, setJobImage] = useState<string | null>(null);
  const [jobDenial, setJobDenial] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (card.type !== "job_offer") return;
    const id = String(card.jobId ?? "");
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await api.getJob(id);
        if (cancelled) return;
        const status = String(row.status ?? row.job?.status ?? "");
        if (status) setJobStatus(status);
        if (row.resultText) setJobResult(row.resultText);
        if (row.imageB64) setJobImage(row.imageB64);
        if (row.denial) setJobDenial(row.denial);
        setJobPhase(jobPhaseFromStatus(status));
      } catch {
        /* quoted job may not exist on this API yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.type, card.jobId]);

  useEffect(() => {
    if (card.type === "swap_prepare" || card.type === "media_result" || card.type === "bridge_quote" || card.type === "job_offer") {
      onExecutionStateChange(execKey, {
        approveStatus,
        swapStatus,
        sendStatus,
        approveHash,
        swapHash,
        sendHash,
        payBusy: jobPhase === "running" || jobPhase === "locking",
      });
    }
  }, [card.type, execKey, approveStatus, swapStatus, sendStatus, approveHash, swapHash, sendHash, jobPhase, onExecutionStateChange]);

  if (
    card.type === "fassets_desk" ||
    card.type === "fassets_redeem_prep" ||
    card.type === "fassets_redeem_status" ||
    card.type === "ftso_signals" ||
    card.type === "fdc_receipt" ||
    card.type === "x402_quote"
  ) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber-200">Not on 0G</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]">
          FAssets, FTSO, FDC, LayerZero OFT, and x402 are not Beacon 0G rails. Jobs lock native 0G.
          Optional USDC.e is a quoted Zia swap, fail-closed.
        </p>
        <button
          type="button"
          onClick={() => onQuickReply("Swap 0.2 0G to USDC.e")}
          className="mt-3 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs"
        >
          Quote a Zia swap
        </button>
      </div>
    );
  }

  if (card.type === "capabilities") {
    const items = Array.isArray(card.items) ? card.items : [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {String(card.title ?? "Capabilities")}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const row = item as { name?: string; description?: string; group?: string };
            return (
              <li key={String(row.name)} className="rounded-xl border border-[var(--p-border)] px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--p-muted)]">{row.group}</p>
                <p className="mt-1 text-sm font-medium text-[var(--p-fg)]">{row.name}</p>
                <p className="mt-1 text-xs text-[var(--p-muted)]">{row.description}</p>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (card.type === "swap_assets") {
    const routes = Array.isArray(card.routes) ? card.routes : [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {String(card.title ?? "Zia assets")}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.summary ?? "")}</p>
        {card.asOf ? (
          <p className="mt-1 font-mono text-[10px] text-[var(--p-faint)]">Quoted {String(card.asOf)}</p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {routes.map((row) => {
            const r = row as {
              from?: { symbol?: string };
              to?: { symbol?: string };
              fee?: number;
              pool?: string;
              amountInDisplay?: string;
              estimatedOutDisplay?: string;
              executableFromSafe?: boolean;
            };
            const key = `${r.from?.symbol}-${r.to?.symbol}-${r.fee}`;
            return (
              <li key={key} className="rounded-xl border border-[var(--p-border)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--p-fg)]">
                  {r.from?.symbol} → {r.to?.symbol}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[var(--p-muted)]">
                  {r.amountInDisplay ?? "—"} → ~{r.estimatedOutDisplay ?? "—"} · fee {r.fee}
                </p>
                {r.pool ? (
                  <p className="mt-1 break-all font-mono text-[10px] text-[var(--p-faint)]">Pool {r.pool}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-amber-200/90">
                  {r.executableFromSafe
                    ? "Executable from Beacon Safe if TeeML ALLOW."
                    : "Quote only — Safe cannot execute this direction."}
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs"
                  onClick={() =>
                    onQuickReply(
                      `Swap ${r.amountInDisplay ?? `0.01 ${r.from?.symbol ?? "0G"}`} to ${r.to?.symbol}`,
                    )
                  }
                >
                  Quote this pair
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (card.type === "bridge_catalog") {
    const routes = Array.isArray(card.routes) ? card.routes : [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {String(card.title ?? "Bridge to 0G")}
        </p>
        <p className="mt-2 text-sm text-[var(--p-muted)]">{String(card.summary ?? "")}</p>
        <ul className="mt-3 space-y-3">
          {routes.map((row) => {
            const r = row as {
              venue?: string;
              source?: string;
              href?: string;
              eta?: string;
              assets?: string;
              reason?: string;
            };
            return (
              <li key={String(r.venue)} className="rounded-xl border border-[var(--p-border)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--p-fg)]">
                  {r.venue} · {r.source} → 0G
                </p>
                <p className="mt-1 text-xs text-[var(--p-muted)]">
                  {r.assets} · ETA {r.eta}
                </p>
                <p className="mt-1 text-xs text-amber-200/90">{r.reason}</p>
                {r.href ? (
                  <a
                    href={r.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex text-xs text-[var(--p-accent-text)] underline"
                  >
                    Open venue
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-amber-200/90">
          Beacon Safe cannot sign a source-chain tx. Say “Bridge 1 USDC from Base to 0G” for a live LI.FI quote.
        </p>
      </div>
    );
  }

  if (card.type === "bridge_quote") {
    const fromChainId = Number(card.fromChainId ?? 0);
    const txReq = card.transactionRequest as
      | { to: string; data: string; value: string; chainId: number }
      | null
      | undefined;
    const canSign = Boolean(wallet && txReq?.to && txReq?.data && card.executableFromUserWallet);
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {String(card.title ?? "Bridge")}
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Source</p>
            <p>{String(card.source)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Destination</p>
            <p>{String(card.destination)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">You send</p>
            <p>
              {String(card.amountIn)} {String(card.assetIn)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Estimated receive</p>
            <p>
              ~{String(card.estimatedOut)} {String(card.assetOut)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Min received</p>
            <p>{String(card.minOut)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">ETA</p>
            <p>~{String(card.etaSeconds)}s</p>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[var(--p-muted)]">{String(card.feeSummary ?? "")}</p>
        <p className="mt-2 text-xs text-amber-200/90">{String(card.honesty)}</p>
        {(card.requiredSignatures as string[] | undefined)?.map((line) => (
          <p key={line} className="mt-1 text-xs text-[var(--p-fg)]">
            {line}
          </p>
        ))}
        <div className="mt-3 space-y-2">
          <StatusRow label="Approve USDC" status={approveStatus} hash={approveHash} chainId={fromChainId} />
          <StatusRow label="Source tx" status={swapStatus} hash={swapHash} chainId={fromChainId} />
          <StatusRow label="Destination" status={sendStatus} hash={sendHash} chainId={16661} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-ink">
              Connect wallet
            </button>
          )}
          {canSign && swapStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await executeLifiBridge({
                      transactionRequest: {
                        to: txReq!.to,
                        data: txReq!.data as `0x${string}`,
                        value: txReq!.value,
                        chainId: txReq!.chainId,
                      },
                      approvalAddress: typeof card.approvalAddress === "string" ? card.approvalAddress : null,
                      fromToken: typeof card.fromToken === "string" ? card.fromToken : undefined,
                      fromAmount: typeof card.amountAtomic === "string" ? card.amountAtomic : undefined,
                      onStep: (step) => {
                        if (step.step === "approve") {
                          setApproveStatus(step.status === "skipped" ? "skipped" : step.status);
                          if (step.hash) setApproveHash(step.hash);
                        }
                        if (step.step === "send") {
                          setSwapStatus(step.status === "failed" ? "failed" : step.status);
                          if (step.hash) setSwapHash(step.hash);
                        }
                      },
                    });
                    setSwapHash(result.sourceHash);
                    setSwapStatus("confirmed");
                    setSendStatus("pending");
                    onTxConfirmed?.({
                      kind: "bridge",
                      title: String(card.title ?? "Bridge"),
                      hash: result.sourceHash,
                      explorerUrl: explorerTx(result.sourceHash, fromChainId),
                      meta: { fromChainId, honesty: "Source confirmed. Destination is not complete yet." },
                    });
                    let destOk = false;
                    for (let i = 0; i < 40; i += 1) {
                      const st = await api.lifiBridgeStatus(result.sourceHash, fromChainId);
                      const ready = Boolean(st.complete && st.receivingTx);
                      setSendStatus(ready ? "confirmed" : "pending");
                      if (st.receivingTx) setSendHash(st.receivingTx);
                      if (ready) {
                        destOk = true;
                        onTxConfirmed?.({
                          kind: "bridge",
                          title: `${String(card.title ?? "Bridge")} destination`,
                          hash: st.receivingTx!,
                          explorerUrl: explorerTx(st.receivingTx!, 16661),
                          meta: { complete: true, source: result.sourceHash },
                        });
                        break;
                      }
                      await new Promise((r) => setTimeout(r, 8000));
                    }
                    if (!destOk) {
                      const fail = classifyExecutionFailure(new Error("LI.FI status is PENDING"));
                      setError(fail.message);
                    }
                  } catch (e) {
                    const fail = classifyExecutionFailure(e);
                    setError(fail.message);
                    setSwapStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? "Sign on source chain…" : "Bridge"}
            </button>
          )}
          {swapHash && (
            <a
              href={explorerTx(swapHash, fromChainId)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
            >
              Source TX
            </a>
          )}
          {sendHash && (
            <a
              href={explorerTx(sendHash, 16661)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
            >
              Destination TX
            </a>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-[var(--p-danger)]">{error}</p>}
        {swapStatus === "confirmed" && sendStatus !== "confirmed" && (
          <p className="mt-3 text-sm text-[var(--p-fg)]">
            Source confirmed. Destination is complete only when LI.FI reports DONE with a 0G tx.
          </p>
        )}
        {sendStatus === "confirmed" && sendHash && (
          <p className="mt-3 text-sm text-[var(--p-accent-text)]">Destination detected on Aristotle.</p>
        )}
      </div>
    );
  }

  if (card.type === "inspect_result") {
    const inspect = (card.inspect ?? {}) as {
      address?: string;
      hash?: string;
      explorer?: string;
      isContract?: boolean;
      bytecodeBytes?: number;
      nativeBalanceWei?: string;
      nativeBalance0g?: string;
      nonce?: number;
      status?: string;
      from?: string;
      to?: string;
      selector?: string;
      gasUsed?: string;
      blockNumber?: string;
      nativeValue0g?: string;
      inputBytes?: number;
      logs?: number;
      implementation?: string | null;
      risks?: string[];
      verifiedNote?: string;
      token?: { name?: string; symbol?: string; decimals?: number };
      transfers?: Array<{ token?: string; symbol?: string; from?: string; to?: string; display?: string; value?: string }>;
      tokenBalances?: Array<{ symbol: string; balance: string }>;
      owner?: string | null;
      interfaceIds?: string[];
      eip1967Implementation?: string | null;
      txType?: string;
      gasPriceWei?: string;
      effectiveGasPriceWei?: string;
      confirmations?: number;
    };
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {String(card.title ?? "Inspect")}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-[var(--p-fg)]">
          {inspect.address ?? inspect.hash}
        </p>
        {inspect.status ? <p className="mt-2 text-sm text-[var(--p-fg)]">Status {inspect.status}</p> : null}
        {inspect.isContract != null ? (
          <p className="mt-2 text-sm text-[var(--p-fg)]">
            {inspect.isContract ? `Contract · ${inspect.bytecodeBytes} bytes` : "EOA · no bytecode"}
          </p>
        ) : null}
        {inspect.nativeBalance0g ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-fg)]">Native {inspect.nativeBalance0g} 0G</p>
        ) : null}
        {inspect.nonce != null ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Nonce {inspect.nonce}</p>
        ) : null}
        {inspect.token?.symbol ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-fg)]">
            Token {inspect.token.symbol}
            {inspect.token.name ? ` · ${inspect.token.name}` : ""}
            {inspect.token.decimals != null ? ` · ${inspect.token.decimals} decimals` : ""}
          </p>
        ) : null}
        {inspect.from ? (
          <p className="mt-1 break-all font-mono text-xs text-[var(--p-muted)]">From {inspect.from}</p>
        ) : null}
        {inspect.to ? (
          <p className="mt-1 break-all font-mono text-xs text-[var(--p-muted)]">To {inspect.to}</p>
        ) : null}
        {inspect.gasUsed ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Gas used {inspect.gasUsed}</p>
        ) : null}
        {inspect.blockNumber ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Block {inspect.blockNumber}</p>
        ) : null}
        {inspect.nativeValue0g ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Value {inspect.nativeValue0g} 0G</p>
        ) : null}
        {inspect.inputBytes != null ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Input {inspect.inputBytes} bytes</p>
        ) : null}
        {inspect.logs != null ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Logs {inspect.logs}</p>
        ) : null}
        {inspect.txType != null ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Type {inspect.txType}</p>
        ) : null}
        {inspect.confirmations != null ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Confirmations {inspect.confirmations}</p>
        ) : null}
        {inspect.effectiveGasPriceWei ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">
            Effective gas {inspect.effectiveGasPriceWei}
          </p>
        ) : inspect.gasPriceWei ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Gas price {inspect.gasPriceWei}</p>
        ) : null}
        {inspect.selector ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">Selector {inspect.selector}</p>
        ) : null}
        {(inspect.risks ?? []).map((risk) => (
          <p key={risk} className="mt-2 text-sm text-[var(--p-muted)]">
            {risk}
          </p>
        ))}
        {inspect.verifiedNote ? (
          <p className="mt-2 text-xs text-amber-200/90">{inspect.verifiedNote}</p>
        ) : null}
        {(inspect.tokenBalances ?? []).map((row) => (
          <p key={row.symbol} className="mt-1 font-mono text-xs text-[var(--p-fg)]">
            {row.symbol} · {row.balance}
          </p>
        ))}
        {(inspect.transfers ?? []).map((row, i) => (
          <p key={`${row.token}-${i}`} className="mt-1 break-all font-mono text-xs text-[var(--p-fg)]">
            Transfer {row.display ?? row.value ?? "?"}
            {row.symbol && !row.display ? ` ${row.symbol}` : ""}
            {row.from ? ` · ${row.from.slice(0, 8)}…` : ""}
            {row.to ? ` → ${row.to.slice(0, 8)}…` : ""}
          </p>
        ))}
        {inspect.owner ? (
          <p className="mt-1 font-mono text-xs text-[var(--p-muted)]">owner {inspect.owner}</p>
        ) : null}
        {inspect.implementation ? (
          <p className="mt-1 break-all font-mono text-xs text-[var(--p-muted)]">
            implementation {inspect.implementation}
          </p>
        ) : null}
        {inspect.eip1967Implementation ? (
          <p className="mt-1 break-all font-mono text-xs text-[var(--p-muted)]">
            EIP-1967 implementation {inspect.eip1967Implementation}
          </p>
        ) : null}
        {(inspect.interfaceIds ?? []).map((id) => (
          <p key={id} className="mt-1 font-mono text-xs text-[var(--p-muted)]">
            supportsInterface {id}
          </p>
        ))}
        {inspect.explorer ? (
          <a
            href={inspect.explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-sm text-[var(--p-accent-text)] underline"
          >
            Open in Explorer
          </a>
        ) : null}
        {(inspect.address || inspect.hash) && (
          <button
            type="button"
            className="ml-3 mt-3 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs"
            onClick={() =>
              onQuickReply(
                `Explain ${inspect.address ?? inspect.hash} from the live evidence.`,
              )
            }
          >
            Explain with TeeML
          </button>
        )}
      </div>
    );
  }

  if (card.type === "spend_breakdown") {
    return <SpendBreakdownCard card={card} />;
  }

  if (card.type === "swap_clarify") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">0G</p>
            <p className="font-display text-lg">{String(card.usdt0Balance ?? "-")}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">USDC.e</p>
            <p className="font-display text-lg">{String(card.fxrpBalance ?? "-")}</p>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {["1", "5", "10", "all"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onQuickReply(a === "all" ? "swap all" : `swap ${a}`)}
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {a === "all" ? "Swap all" : `${a} 0G`}
            </button>
          ))}
          <a
            href={String(card.faucetHref)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)]"
          >
            Faucet
          </a>
        </div>
      </div>
    );
  }

  if (card.type === "swap_quote") {
    const symbolIn = String(card.symbolIn ?? "0G");
    const symbolOut = String(card.symbolOut ?? "USDC.e");
    const est = String(card.estimatedOut ?? card.estimatedFxrp);
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[var(--p-shadow)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive ?? "Zia")}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">You pay</p>
            <p className="font-display text-2xl text-[var(--p-fg)]">
              {String(card.amountInDisplay)} {symbolIn}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Est. receive</p>
            <p className="font-display text-2xl text-[var(--p-accent-text)]">
              ~{est} {symbolOut}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">
          {String(card.network)}
          {card.chainId ? ` · chain ${String(card.chainId)}` : ""} · desk 0G {String(card.usdt0Balance)}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.note)}</p>
        {card.ftsoGuard ? (
          <p className="mt-2 text-xs text-signal/90">
            Live market data used to protect this execution
            {typeof (card.ftsoGuard as { feedAge?: number }).feedAge === "number"
              ? ` · FTSO age ${(card.ftsoGuard as { feedAge: number }).feedAge}s`
              : ""}
            .
          </p>
        ) : null}
        {card.honesty ? <p className="mt-2 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}
        <FccHardwareStrip card={card} />
        <button
          type="button"
          onClick={() => onQuickReply("confirm")}
          className="mt-4 rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink"
        >
          Confirm swap
        </button>
      </div>
    );
  }

  if (card.type === "swap_pairs") {
    const pairs = (card.pairs as Array<{
      symbolA: string;
      symbolB: string;
      bestFee: number;
      liquidity: string;
    }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--p-muted)]">
          {String(card.network)} · chain {String(card.chainId)}
        </p>
        <ul className="mt-3 space-y-2">
          {pairs.map((p) => (
            <li
              key={`${p.symbolA}-${p.symbolB}-${p.bestFee}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-sm"
            >
              <span className="font-display">
                {p.symbolA}/{p.symbolB}
              </span>
              <span className="font-mono text-[10px] text-[var(--p-muted)]">
                fee {p.bestFee} · liq {p.liquidity.slice(0, 12)}…
              </span>
              <button
                type="button"
                onClick={() => onQuickReply(`swap 1 ${p.symbolA} to ${p.symbolB}`)}
                className="rounded-full border border-[var(--p-border)] px-2 py-0.5 text-[10px] hover:border-signal/40"
              >
                Quote
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "portfolio_desk") {
    const positions = (card.positions as Array<{ symbol: string; balance: string; usdValue: number | null }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive)}
          </span>
        </div>
        <p className="mt-2 font-display text-2xl text-[var(--p-fg)]">~${Number(card.totalUsd).toFixed(2)}</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {positions.map((p) => (
            <li key={p.symbol} className="flex justify-between gap-2">
              <span>{p.symbol}</span>
              <span className="text-[var(--p-muted)]">
                {p.balance}
                {p.usdValue != null ? ` · $${p.usdValue.toFixed(2)}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "yield_vaults") {
    const vaults = (card.vaults as Array<{
      id: string;
      vault: string;
      assetSymbol?: string;
      totalAssetsDisplay?: string;
      sharePriceDisplay?: string | null;
      userSharesDisplay?: string;
      explorer?: string;
      error?: string;
    }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--p-muted)]">
          {String(card.network)} · chain {String(card.chainId)} · no APY invented
        </p>
        <ul className="mt-3 space-y-2">
          {vaults.map((v) => (
            <li key={v.id} className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-sm">
              <p className="font-display capitalize">{v.id}</p>
              {v.error ? (
                <p className="text-xs text-amber-200/90">{v.error}</p>
              ) : (
                <p className="font-mono text-[10px] text-[var(--p-muted)]">
                  {v.assetSymbol ?? "asset"}
                  {v.totalAssetsDisplay != null ? ` · TVL ${v.totalAssetsDisplay}` : ""}
                  {v.sharePriceDisplay != null ? ` · share ${v.sharePriceDisplay}` : ""}
                  {v.userSharesDisplay != null ? ` · your shares ${v.userSharesDisplay}` : ""}
                </p>
              )}
              {v.explorer ? (
                <a href={v.explorer} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[10px] text-signal">
                  Explorer
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "market_intel") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-4 shadow-[var(--p-shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive)}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">P(risk-on)</p>
            <p className="font-display text-xl">{Number(card.probabilityRiskOn).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Confidence</p>
            <p className="font-display text-xl">{Number(card.confidence).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Risk</p>
            <p className="font-display text-xl">{String(card.risk)}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--p-fg)]">{String(card.recommendedAction)}</p>
        <p className="mt-2 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "swap_prepare") {
    const symbolIn = String(card.symbolIn ?? "0G");
    const symbolOut = String(card.symbolOut ?? "USDC.e");
    const est = String(card.estimatedOut ?? card.estimatedFxrp);
    const isSafe = card.mode === "beacon_safe" || card.requiresMetaMask === false;
    const canExecute = isSafe && card.executableFromSafe !== false;
    const quoteStale = swapQuoteExpired(typeof card.quotedAt === "string" ? card.quotedAt : undefined);
    const chainId = Number(card.chainId ?? 16661);
    if (!isSafe && (chainId === 14 || card.mode === "sparkdex_mainnet" || card.requiresChainSwitch)) {
      return (
        <div className="rounded-2xl border border-amber-500/30 bg-[var(--p-card)] p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber-200">
            Mainnet path blocked
          </p>
          <p className="mt-2 text-sm text-[var(--p-fg)]">
            Beacon stays on <strong>0G Aristotle (16661)</strong>. We never ask MetaMask to
            switch to Mainnet for Flow swaps.
          </p>
          <p className="mt-2 text-xs text-[var(--p-muted)]">
            Fund Beacon Safe for 0G→USDC.e agent execution, or use another Aristotle rail.
          </p>
          <a
            href="/flow/security"
            className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
          >
            Open Beacon Safe
          </a>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.ogPrimitive ?? (isSafe ? "Beacon Safe" : "Zia"))}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--p-fg)]/80">
          Swap <span className="text-[var(--p-fg)]">{String(card.amountInDisplay)} {symbolIn}</span>
          {" → "}
          <span className="text-[var(--p-accent-text)]">~{est} {symbolOut}</span>
          {" · "}
          {String(card.network ?? "0G Aristotle")}
        </p>
        <dl className="mt-3 grid gap-2 font-mono text-[11px] text-[var(--p-muted)] sm:grid-cols-2">
          {card.route != null && (
            <div>
              <p>Route</p>
              <p className="text-[var(--p-fg)]">{String(card.route)}</p>
            </div>
          )}
          {card.fee != null && (
            <div>
              <p>Pool fee</p>
              <p className="text-[var(--p-fg)]">{String(card.fee)}</p>
            </div>
          )}
          {card.pool != null && (
            <div>
              <p>Pool</p>
              <p className="break-all text-[var(--p-fg)]">{String(card.pool)}</p>
            </div>
          )}
          {card.impactBps != null && (
            <div>
              <p>Price impact</p>
              <p className="text-[var(--p-fg)]">{String(card.impactBps)} bps</p>
            </div>
          )}
          {card.minReceived != null && (
            <div>
              <p>Min received</p>
              <p className="text-[var(--p-fg)]">
                {String(card.minReceived)} {symbolOut}
              </p>
            </div>
          )}
          {card.quotedAt != null && (
            <div>
              <p>Quote time</p>
              <p className="text-[var(--p-fg)]">{String(card.quotedAt)}</p>
            </div>
          )}
          {card.quoteExpiresAt != null && (
            <div>
              <p>Quote expires</p>
              <p className="text-[var(--p-fg)]">{String(card.quoteExpiresAt)}</p>
            </div>
          )}
          {card.policyStatus != null && (
            <div className="sm:col-span-2">
              <p>Policy</p>
              <p className="text-[var(--p-fg)]">{String(card.policyStatus)}</p>
            </div>
          )}
        </dl>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.warning)}</p>
        {card.honesty ? <p className="mt-1 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}
        {!canExecute && card.executeBlock ? (
          <p className="mt-2 text-sm text-[var(--p-fg)]">{String(card.executeBlock)}</p>
        ) : null}
        <FccHardwareStrip card={card} />
        {isSafe ? (
          <p className="mt-2 text-xs text-signal">
            Agent executor spends from Beacon Safe on Aristotle — no MetaMask, no Mainnet switch.
          </p>
        ) : card.requiresChainSwitch ? (
          <p className="mt-2 text-xs text-signal">MetaMask will switch to 0G Aristotle (chain 16661) before signing.</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {isSafe ? (
            <>
              <StatusRow label="Safe spend" status={approveStatus} hash={approveHash} chainId={chainId} />
              <StatusRow label="Desk fulfill" status={swapStatus} hash={swapHash} chainId={chainId} />
            </>
          ) : (
            <>
              <StatusRow label={`Approve ${symbolIn}`} status={approveStatus} hash={approveHash} chainId={chainId} />
              <StatusRow label="Swap" status={swapStatus} hash={swapHash} chainId={chainId} />
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
              Connect wallet
            </button>
          )}
          {wallet && swapStatus !== "confirmed" && canExecute && (
            <button
              type="button"
              disabled={busy || quoteStale}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    if (swapQuoteExpired(typeof card.quotedAt === "string" ? card.quotedAt : undefined)) {
                      throw new Error("OFFER_EXPIRED");
                    }
                    if (!isSafe) {
                      throw new Error(
                        "Beacon refused this swap. Execute from Beacon Safe so only the allowlisted Zia router can spend.",
                      );
                    }
                    setApproveStatus("pending");
                    const session = await ensureSafeAgentSession(wallet);
                    const result = await api.executeSafeSwap({
                      wallet,
                      amountInUnits: String(card.amountInDisplay),
                      recipient: wallet,
                      slippageBps: Number(card.slippageBps ?? 100),
                      tokenIn: String(card.tokenIn ?? symbolIn),
                      tokenOut: String(card.tokenOut ?? symbolOut),
                      sessionToken: session.token,
                    });
                    if (!("spendHash" in result) || !result.spendHash) {
                      throw new Error((result as { error?: string }).error || "Safe swap failed");
                    }
                    setApproveHash(result.spendHash);
                    setApproveStatus("confirmed");
                    setSwapHash(result.fulfillHash);
                    setSwapStatus("confirmed");
                    onBalancesRefresh();
                    onTxConfirmed?.({
                      kind: "swap",
                      title: `Beacon Safe ${symbolIn}→${symbolOut} · ${String(card.amountInDisplay ?? "")}`,
                      hash: result.fulfillHash,
                      explorerUrl: explorerTx(result.fulfillHash, chainId),
                      meta: { ogPrimitive: "Beacon Safe · Aristotle", chainId },
                    });
                  } catch (e) {
                    const fail = classifyExecutionFailure(e);
                    setError(fail.message);
                    setSwapStatus((prev) => (prev === "pending" ? "failed" : prev));
                    setApproveStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {busy
                ? isSafe
                  ? "Executing…"
                  : "Signing…"
                : isSafe
                  ? "Execute from Beacon Safe"
                  : card.requiresChainSwitch
                    ? "Switch + Approve + Swap"
                    : "Approve + Swap"}
            </button>
          )}
          <a
            href={NETWORK.faucet}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-muted)]"
          >
            Aristotle faucet
          </a>
        </div>
        {quoteStale ? (
          <p className="mt-2 text-sm text-[var(--p-danger)]">This quote expired. Ask for a new quote before executing.</p>
        ) : null}
        {error && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-[var(--p-danger)]">{error}</p>
            {/per-job app limit|daily app budget|app limits/i.test(error) ? (
              <Link
                to="/flow/security"
                className="inline-flex rounded-full border border-[var(--p-border-strong)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-[var(--p-accent)]/45 hover:text-[var(--p-fg)]"
              >
                Open Safe → App limits
              </Link>
            ) : null}
          </div>
        )}
        {swapStatus === "confirmed" && swapHash && (
          <p className="mt-3 text-sm text-[var(--p-accent-text)]">
            Swap confirmed.{" "}
            <a
              href={explorerTx(swapHash, chainId)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              View on explorer
            </a>
          </p>
        )}
      </div>
    );
  }

  if (card.type === "media_clarify") {
    const prompts = (card.prompts as string[]) ?? [];
    const isVideo = false;
    const isImage = card.kind === "image";
    const isResearch = card.kind === "research";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        {isResearch && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--p-fg)]">
            Research a protocol, product, competitor, market, project, or topic. You get findings,
            conclusions, and caveats — not invented citations.
          </p>
        )}
        {!isResearch && (
          <ul className="mt-3 space-y-1.5 text-sm text-[var(--p-muted)]">
            {prompts.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="text-[var(--p-accent-text)]">·</span>
                {p}
              </li>
            ))}
          </ul>
        )}
        {isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["15", "30", "60"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onQuickReply(`${d} sec, 9:16, cinematic`)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {d}s
              </button>
            ))}
          </div>
        )}
        {isResearch && (
          <div className="mt-3 flex flex-wrap gap-2">
            {prompts.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => onQuickReply(text)}
                className="max-w-full rounded-full border border-[var(--p-border)] px-3 py-1.5 text-left text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {isImage && !isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "Minimal green", text: "Company Beacon, colors green + black, minimal geometric, transparent yes" },
              { label: "Bold mark", text: "Bold logo mark, high contrast, no serif, transparent background" },
              { label: "Skip to quote", text: "Name Beacon OS, colors signal green, style minimal, transparent yes" },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onQuickReply(c.text)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {typeof card.deskHref === "string" && card.deskHref ? (
          <Link to={card.deskHref} className="mt-3 inline-flex text-sm text-[var(--p-accent-text)] underline-offset-2 hover:underline">
            Open Agent Jobs
          </Link>
        ) : null}
      </div>
    );
  }

  if (card.type === "authorization_receipt") {
    const allowed = card.allowed === true;
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border px-4 py-4",
          allowed
            ? "border-signal/40 bg-signal/10"
            : "border-[var(--p-danger)]/40 bg-[var(--p-danger)]/5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-muted)]">
            {String(card.title ?? "Authorization Receipt")}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-mono text-[10px]",
              allowed
                ? "bg-signal/20 text-[var(--p-accent-text)]"
                : "bg-[var(--p-danger)]/15 text-[var(--p-danger)]",
            )}
          >
            {allowed ? "ALLOWED" : "BLOCKED"}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--p-fg)]">
          {String(card.reason ?? "Policy decision")}
        </p>
        <FccHardwareStrip card={card} />
        <dl className="mt-3 space-y-1 font-mono text-[11px] text-[var(--p-muted)]">
          {card.serviceId != null && (
            <div>
              Service · {String(card.serviceId)}
              {card.priceUsdt0 != null ? ` · ${String(card.priceUsdt0)} 0G` : ""}
            </div>
          )}
          <div>{String(card.ogPrimitive ?? "Security Policy · server-enforced")}</div>
          {card.teeMode === "simulated" && (
            <div className="mt-2 inline-flex rounded-full border border-signal/35 bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              Confidential policy (simulated TEE)
            </div>
          )}
          {card.teeMode === "verified" && (
            <div className="mt-2 inline-flex rounded-full border border-signal/35 bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              Confidential policy (hardware TEE)
            </div>
          )}
          <div className="mt-1">Server policy · Aristotle · pause anytime in Safe</div>
        </dl>
        {!allowed && (
          <a
            href="/flow/security"
            className="mt-3 inline-flex rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
          >
            Adjust spend policy
          </a>
        )}
      </div>
    );
  }

  if (card.type === "media_result") {
    const summary = typeof card.summary === "string" ? card.summary : "";
    const content = typeof card.content === "string" ? card.content : "";
    const isImage = content.startsWith("data:image");
    const isResearch = card.kind === "research";
    // Avoid triple-paste: chat line + summary + content when they are the same stub.
    const showSummary =
      Boolean(summary) &&
      (!content || summary.trim() !== content.trim()) &&
      !/paid research brief unlocked/i.test(summary);

    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-4 shadow-[var(--p-shadow)]">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        {showSummary && <p className="mt-2 text-sm text-[var(--p-muted)]">{summary}</p>}
        {typeof card.modelId === "string" && card.modelId && (
          <p className="mt-2 font-mono text-[11px] text-[var(--p-muted)]">
            {card.modelId}
            {typeof card.lock0g === "string" ? ` · ${card.lock0g}` : ""}
          </p>
        )}
        {typeof card.paymentTxHint === "string" && card.paymentTxHint && (
          <a
            href={explorerTx(card.paymentTxHint, 16661)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--p-accent-text)] hover:underline"
          >
            Settlement tx · {card.paymentTxHint.slice(0, 10)}…
            <ExternalLink className="size-3" />
          </a>
        )}
        {isImage && (
          <img src={content} alt="Beacon result" className="mt-3 max-h-72 w-full max-w-full rounded-xl border border-[var(--p-border)] object-contain" />
        )}
        {isResearch && content && (
          <div className="mt-3 border-t border-[var(--p-border)] pt-3">
            <SafeMarkdown text={content} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {isResearch && content && (
            <>
              <button
                type="button"
                className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                onClick={() => void navigator.clipboard.writeText(content)}
              >
                Copy
              </button>
              <button
                type="button"
                className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                onClick={() => {
                  const blob = new Blob([content], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "beacon-report.md";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .md
              </button>
              <button
                type="button"
                className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                onClick={() => {
                  const blob = new Blob([content], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "beacon-report.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .txt
              </button>
            </>
          )}
          {typeof card.jobId === "string" && card.jobId && (
            <Link
              to={`/verify/${card.jobId}`}
              className="inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
            >
              View proof
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (card.type === "quote") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          Native 0G
        </p>
        <p className="mt-1 font-medium text-[var(--p-fg)]">{String(card.title ?? "Quote")}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{String(card.summary ?? "")}</p>
        {typeof card.savings0g === "string" && card.savings0g && (
          <p className="mt-2 font-mono text-[11px] text-[var(--p-accent-text)]">Saves {card.savings0g} vs last chat job</p>
        )}
      </div>
    );
  }

  if (card.type === "job_offer") {
    const jobId = String(card.jobId ?? "");
    const quoteId = String(card.quoteId ?? "");
    const proofHref = String(card.proofHref ?? `/verify/${jobId}`);
    const deskHref = String(card.deskHref ?? `/flow/desk?job=${jobId}`);
    const running = jobPhase === "locking" || jobPhase === "running";
    const done = jobPhase === "done";
    const failed = jobPhase === "failed";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
          {running ? "Job running" : done ? "Job complete" : failed ? "Job failed" : String(card.title ?? "Start job")}
        </p>
        <p className="mt-2 text-sm text-[var(--p-fg)]">{String(card.summary ?? "")}</p>
        <dl className="mt-3 grid gap-2 font-mono text-[11px] text-[var(--p-muted)] sm:grid-cols-3">
          <div>ID · {jobId.slice(0, 8)}…</div>
          <div>Cost · {String(card.lockDisplay ?? "")}</div>
          <div>Model · {String(card.modelId ?? "")}</div>
        </dl>
        {jobStatus && <p className="mt-2 text-sm text-[var(--p-fg)]">Status {jobStatus}</p>}
        {(() => {
          const pipe = jobPipeline(jobStatus);
          return (
            <div className="mt-2">
              <p className="font-mono text-[10px] text-[var(--p-muted)]">
                {pipe.label} · {pipe.pct}%
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--p-surface-2)]">
                <div className="h-full bg-signal" style={{ width: `${pipe.pct}%` }} />
              </div>
            </div>
          );
        })()}
        {jobDenial && <p className="mt-2 text-sm text-[var(--p-danger)]">{jobDenial}</p>}
        {(jobResult || jobImage) && (
          <div ref={resultRef} className="mt-3 max-h-64 overflow-y-auto border-t border-[var(--p-border)] pt-3">
            {jobImage && (
              <img src={`data:image/png;base64,${jobImage}`} alt="Job result" className="mb-3 max-h-64 rounded-xl" />
            )}
            {jobResult ? <SafeMarkdown text={jobResult} /> : null}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-ink">
              Connect wallet
            </button>
          )}
          {wallet && jobPhase === "idle" && (
            <button
              type="button"
              disabled={busy}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setJobPhase("locking");
                  try {
                    const session = await ensureSafeAgentSession(wallet);
                    await api.approveJobFromSafe(jobId, quoteId, {
                      ownerWallet: wallet,
                      sessionToken: session.token,
                    });
                    setJobPhase("running");
                    setJobStatus("AUTHORIZED");
                    let settled = false;
                    for (let i = 0; i < 80; i += 1) {
                      const row = await api.getJob(jobId);
                      const status = String(row.status ?? row.job?.status ?? "");
                      setJobStatus(status);
                      if (row.resultText) setJobResult(row.resultText);
                      if (row.imageB64) setJobImage(row.imageB64);
                      if (row.denial) setJobDenial(row.denial);
                      if (["PASSED", "CLOSED", "SETTLING"].includes(status)) {
                        settled = true;
                        setJobPhase("done");
                        onBalancesRefresh();
                        onTxConfirmed?.({
                          kind: "proof",
                          title: `Job ${jobId.slice(0, 8)}`,
                          hash: jobId,
                          explorerUrl: proofHref.startsWith("http")
                            ? proofHref
                            : `${window.location.origin}${proofHref}`,
                          meta: { status },
                        });
                        break;
                      }
                      if (["FAILED", "REFUSING", "EXPIRED", "CANCELED"].includes(status)) {
                        settled = true;
                        setJobPhase("failed");
                        break;
                      }
                      await new Promise((r) => setTimeout(r, 4000));
                    }
                    if (!settled) {
                      setError(
                        "Job is still running on Aristotle. Open proof for lock/release. Beacon will not invent PASSED.",
                      );
                    }
                  } catch (e) {
                    const fail = classifyExecutionFailure(e);
                    setError(fail.message);
                    setJobPhase("failed");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? "Locking…" : String(card.title ?? "Start")}
            </button>
          )}
          {done && (
            <>
              {(jobResult || jobImage) && (
                <button
                  type="button"
                  className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                  onClick={() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
                >
                  View result
                </button>
              )}
              {jobResult && (
                <>
                  <button
                    type="button"
                    className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                    onClick={() => void navigator.clipboard.writeText(jobResult)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                    onClick={() => {
                      const blob = new Blob([jobResult], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `beacon-${jobId.slice(0, 8)}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download .md
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm"
                    onClick={() => {
                      const blob = new Blob([jobResult], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `beacon-${jobId.slice(0, 8)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download .txt
                  </button>
                </>
              )}
              <Link to={proofHref} className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
                View proof
              </Link>
            </>
          )}
          <Link
            to={deskHref}
            className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-fg)]"
          >
            Jobs history
          </Link>
        </div>
        {error && <p className="mt-2 text-xs text-[var(--p-danger)]">{error}</p>}
        {running && (
          <p className="mt-3 text-xs text-[var(--p-muted)]">Keep chatting. This job stays in Flow.</p>
        )}
      </div>
    );
  }

  if (card.type === "desk_link") {
    const href = String(card.href);
    const isProof = href.includes("/verify/");
    const deskJob = jobIdFromDeskHref(href);
    const cta = isProof ? "View proof" : href.includes("/security") ? "Open Safe" : "Jobs history";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{String(card.summary)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={href} className="inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
            {cta}
          </Link>
          {deskJob && !isProof && (
            <Link
              to={`/verify/${deskJob}`}
              className="inline-flex rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-fg)]"
            >
              View proof
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (card.type === "insufficient") {
    const summary = String(card.summary);
    const inventoryIssue = /inventory|seed the desk/i.test(summary);
    const href = typeof card.faucetHref === "string" ? card.faucetHref : "";
    const internalHref = href.startsWith("/");
    return (
      <div className="rounded-2xl border border-[var(--p-warn)]/35 bg-[var(--p-warn)]/10 p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{summary}</p>
        {inventoryIssue ? (
          <p className="mt-2 text-xs text-[var(--p-muted)]">
            The wallet and Safe are connected. Desk USDC.e liquidity—not your connection—is blocking
            this quote.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {!wallet ? (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
              Connect wallet
            </button>
          ) : inventoryIssue ? (
            <button
              type="button"
              onClick={() => onQuickReply("retry the same swap quote")}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink active:scale-[0.98]"
            >
              Retry quote
            </button>
          ) : internalHref ? (
            <Link
              to={href}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
            >
              Open Beacon Safe
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onQuickReply("retry my last request with my connected wallet")}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink active:scale-[0.98]"
            >
              Retry with wallet
            </button>
          )}
          {href && !internalHref && !inventoryIssue ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm text-[var(--p-muted)]"
            >
              Faucet
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (card.type === "wallet_failure") {
    return (
      <div className="rounded-2xl border border-[var(--p-danger)]/40 bg-[var(--p-danger)]/10 p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-danger)]">
          Wallet · {String(card.kind ?? "error")}
        </p>
        <p className="mt-2 font-medium text-[var(--p-fg)]">{String(card.title ?? "Wallet error")}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]">{String(card.summary ?? "")}</p>
        <p className="mt-3 font-mono text-xs text-[var(--p-muted)]">
          Funds moved · {String(card.fundsMoved ?? "0 0G")}
        </p>
      </div>
    );
  }

  if (card.type === "denied") {
    return (
      <div className="rounded-2xl border border-[var(--p-danger)]/40 bg-[var(--p-danger)]/10 p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-danger)]">Denied</p>
        <p className="mt-2 font-medium text-[var(--p-fg)]">{String(card.title ?? "Why blocked")}</p>
        {card.hard ? <p className="mt-2 text-sm text-[var(--p-fg)]">{String(card.hard)}</p> : null}
        {card.reason ? <p className="mt-2 text-sm text-[var(--p-fg)]">{String(card.reason)}</p> : null}
        {card.semantic ? <p className="mt-2 text-sm text-[var(--p-muted)]">{String(card.semantic)}</p> : null}
        <dl className="mt-3 grid gap-2 font-mono text-xs sm:grid-cols-2">
          {card.requested != null && (
            <div>
              <p className="text-[var(--p-muted)]">Requested</p>
              <p>{String(card.requested)}</p>
            </div>
          )}
          {card.fundsMoved != null && (
            <div>
              <p className="text-[var(--p-muted)]">Funds moved</p>
              <p>{String(card.fundsMoved)}</p>
            </div>
          )}
        </dl>
        {typeof card.proofHref === "string" && (
          <Link
            to={card.proofHref}
            className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
          >
            View proof
          </Link>
        )}
      </div>
    );
  }

  return null;
}

function StatusRow({
  label,
  status,
  hash,
  chainId = 16661,
}: {
  label: string;
  status: string;
  hash: string | null;
  chainId?: number;
}) {
  const icon =
    status === "confirmed" || status === "skipped" ? (
      <CheckCircle2 className="size-3.5 text-[var(--p-accent-text)]" />
    ) : status === "pending" ? (
      <Clock className="size-3.5 animate-pulse text-[var(--p-warn)]" />
    ) : status === "failed" ? (
      <span className="size-3.5 rounded-full bg-red-400" />
    ) : (
      <span className="size-3.5 rounded-full border border-[var(--p-border)]" />
    );
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-[var(--p-muted)]">
        {icon}
        {label}
        <span className="font-mono text-[var(--p-muted)]">{status === "idle" ? "ready" : status}</span>
      </span>
      {hash && (
        <a href={explorerTx(hash, chainId)} target="_blank" rel="noreferrer" className="font-mono text-[var(--p-accent-text)] hover:underline">
          {hash.slice(0, 10)}…
        </a>
      )}
    </div>
  );
}
