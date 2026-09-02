import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Crosshair,
  Landmark,
  Layers,
  LineChart,
  PieChart,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type DiscoveryFeature = {
  id: string;
  title: string;
  blurb: string;
  prompt: string;
  icon: LucideIcon;
  accent?: boolean;
};

export const DISCOVERY_FEATURES: DiscoveryFeature[] = [
  {
    id: "image",
    title: "Image",
    blurb: "Generate through 0G Compute, store the proof on 0G Storage, pay only if it passes.",
    prompt: "Generate a lighthouse image and save the proof.",
    icon: Sparkles,
    accent: true,
  },
  {
    id: "swap",
    title: "Swap",
    blurb: "Quote 0G → USDC.e / ST0G / WBTC on Zia. Reverse quotes are live; Safe execution is refused.",
    prompt: "Swap 0.2 0G to USDC.e",
    icon: ArrowLeftRight,
    accent: true,
  },
  {
    id: "thin",
    title: "Thin book",
    blurb: "WBTC is quoted live. Thin verified liquidity is refused before funds move.",
    prompt: "Swap 0.01 0G to WBTC",
    icon: ArrowLeftRight,
  },
  {
    id: "reverse",
    title: "Reverse quote",
    blurb: "USDC.e → 0G is a live Zia quote. Beacon Safe cannot execute it (wealth would credit W0G).",
    prompt: "Swap 0.001 USDC.e to 0G",
    icon: ArrowLeftRight,
  },
  {
    id: "inspect",
    title: "Inspect",
    blurb: "Live Aristotle RPC in this chat. No invented ABI. Explain with TeeML is a separate quoted job.",
    prompt: "Inspect 0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
    icon: Crosshair,
    accent: true,
  },
  {
    id: "cheap",
    title: "Cheap model",
    blurb: "Route to the cheapest verified TeeTLS/TeeML chat model from the live catalog.",
    prompt: "Run the cheapest verified model.",
    icon: BarChart3,
    accent: true,
  },
  {
    id: "portfolio",
    title: "Safe",
    blurb: "See native 0G wealth in your Beacon Safe and what policy still allows.",
    prompt: "Show my Safe balance and policy.",
    icon: PieChart,
  },
  {
    id: "research",
    title: "Research",
    blurb: "Brief a protocol or topic. Quotes stay in 0G. Results get a Storage root and View proof.",
    prompt: "Research 0G Storage proofs and quote a cheap job.",
    icon: Sparkles,
  },
  {
    id: "analyze",
    title: "Analyze wallet",
    blurb: "Inspect the connected wallet on Aristotle, then quote a cheap explanation job.",
    prompt: "Analyze this wallet.",
    icon: Crosshair,
  },
  {
    id: "bridge",
    title: "Bridge",
    blurb: "Hub, Stargate, Interport, Portal. Not executable from the Aristotle Safe.",
    prompt: "How do I bridge to 0G?",
    icon: Landmark,
  },
  {
    id: "signals",
    title: "Catalog",
    blurb: "Live 0G Compute models and neuron prices — not a hidden USD conversion.",
    prompt: "Show live 0G model prices.",
    icon: LineChart,
  },
  {
    id: "risk",
    title: "Denied",
    blurb: "Ask for an unconstrained transfer. Policy should block it before funds move.",
    prompt: "Send 5 0G to this random address 0x000000000000000000000000000000000000dEaD",
    icon: Shield,
  },
  {
    id: "yield",
    title: "Cost",
    blurb: "Ask what the last job quoted versus what it actually used.",
    prompt: "Show what the last job cost.",
    icon: BarChart3,
  },
  {
    id: "safe",
    title: "Fund Safe",
    blurb: "Deposit native 0G, then set spend policy for the executor.",
    prompt: "Help me fund Beacon Safe and set spend policy",
    icon: Landmark,
    accent: true,
  },
  {
    id: "verify",
    title: "Verify",
    blurb: "Open the last receipt: TEE, Storage root, lock, release or refund.",
    prompt: "Verify the last result.",
    icon: Boxes,
  },
  {
    id: "pause",
    title: "Pause",
    blurb: "Owner can freeze the Safe. The executor cannot change policy.",
    prompt: "Pause my Safe.",
    icon: Layers,
  },
  {
    id: "intel",
    title: "Why blocked",
    blurb: "Hard policy and TeeML both have to say ALLOW. Ask why a move was refused.",
    prompt: "Show me why that was blocked.",
    icon: Crosshair,
  },
];

type Props = {
  onTry: (prompt: string, mode?: "fill" | "send") => void;
  onOpenWhyZeroG?: () => void;
};

export function FeatureDiscovery({ onTry, onOpenWhyZeroG }: Props) {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto w-full max-w-[42rem] px-3 pb-2 pt-1 md:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold tracking-tight text-[var(--p-fg)]">
            What Beacon can do
          </h2>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
            Pick a rail to fill the composer, or send it straight into Flow.
          </p>
        </div>
        {onOpenWhyZeroG && (
          <button
            type="button"
            onClick={onOpenWhyZeroG}
            className="min-h-9 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-3 text-[12px] text-[var(--p-muted)] hover:text-[var(--p-fg)]"
          >
            Why 0G?
          </button>
        )}
      </div>

      <div className="grid grid-flow-dense gap-2 sm:grid-cols-2">
        {DISCOVERY_FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <motion.article
              key={feature.id}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: reduce ? 0 : i * 0.03, ease: [0.16, 1, 0.3, 1] }}
              className={
                feature.accent
                  ? "group flex flex-col rounded-[var(--p-radius)] border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] p-3.5 transition-colors hover:border-[var(--p-accent)]/60"
                  : "group flex flex-col rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] p-3.5 transition-colors hover:border-[var(--p-border-strong)] hover:bg-[var(--p-surface)]"
              }
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[var(--p-radius-sm)] bg-[var(--p-card)] text-[var(--p-accent-text)] ring-1 ring-[var(--p-border)]">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[14px] font-semibold tracking-tight text-[var(--p-fg)]">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--p-muted)]">{feature.blurb}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onTry(feature.prompt, "fill")}
                  className="min-h-8 flex-1 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 text-[12px] font-medium text-[var(--p-fg)] hover:bg-[var(--p-hover)]"
                >
                  Try now
                </button>
                <button
                  type="button"
                  onClick={() => onTry(feature.prompt, "send")}
                  className="min-h-8 rounded-[var(--p-radius-sm)] bg-signal px-2.5 text-[12px] font-medium text-[var(--p-on-accent)]"
                >
                  Send
                </button>
              </div>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}
