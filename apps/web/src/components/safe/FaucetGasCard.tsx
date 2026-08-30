import { ExternalLink, Droplets } from "lucide-react";
import { NETWORK } from "@/lib/chain";

export const ZEROG_FAUCET_URL = NETWORK.faucet;

export function FaucetGasCard() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-xl">
          <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
            <Droplets className="size-3" strokeWidth={2} />
            Step 1 · Fund
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--p-fg)]">
            Get native 0G
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--p-muted)]">
            Beacon Safe is funded with native 0G on Aristotle (chain 16661). Buy or bridge 0G, then
            deposit into your Safe.
          </p>
        </div>
        <a
          href={NETWORK.faucet}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform hover:brightness-105 active:scale-[0.98]"
        >
          Open get.0g.ai
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      </div>
    </section>
  );
}
