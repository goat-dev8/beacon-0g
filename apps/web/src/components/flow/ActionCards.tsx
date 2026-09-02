import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { NETWORK } from "@/lib/chain";
import { explorerTx } from "@/lib/explorers";
import { cn } from "@/lib/utils";
import { ensureSafeAgentSession } from "@/lib/safeSession";
import { AgentText } from "@/components/AgentText";
import type { CardExecutionState, AgentCard } from "@/lib/executionPhases";
import type { ConvState, PaidResendMeta } from "@/lib/flowTypes";

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
    kind: "swap" | "bridge";
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

  useEffect(() => {
    if (card.type === "swap_prepare" || card.type === "media_result") {
      onExecutionStateChange(execKey, {
        approveStatus,
        swapStatus,
        sendStatus: "idle",
        approveHash,
        swapHash,
        sendHash: null,
        payBusy: false,
      });
    }
  }, [card.type, execKey, approveStatus, swapStatus, approveHash, swapHash, onExecutionStateChange]);

  if (
    card.type === "fassets_desk" ||
    card.type === "fassets_redeem_prep" ||
    card.type === "fassets_redeem_status" ||
    card.type === "ftso_signals" ||
    card.type === "fdc_receipt" ||
    card.type === "bridge_quote" ||
    card.type === "bridge_prepare" ||
    card.type === "bridge_clarify" ||
    card.type === "bridge_routes" ||
    card.type === "bridge_intent" ||
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
          {String(card.network ?? (isSafe ? "0G Aristotle Aristotle" : "0G Aristotle"))}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.warning)}</p>
        {card.honesty ? <p className="mt-1 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}
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
          {wallet && swapStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
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
                    setError(e instanceof Error ? e.message : "Swap failed");
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
            <AgentText text={content} />
          </div>
        )}
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
      </div>
    );
  }

  if (card.type === "desk_link") {
    const cta = String(card.href).includes("/security") ? "Open Safe" : "Open desk";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{String(card.summary)}</p>
        <Link to={String(card.href)} className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
          {cta}
        </Link>
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
