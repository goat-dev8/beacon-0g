import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Boxes,
  Landmark,
  LineChart,
  Shield,
  Sparkles,
  Wallet,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type FlowFeature = {
  id: string;
  label: string;
  prompt: string;
  icon: LucideIcon;
};

/** Compact rail chips: short labels, full prompts on select. */
export const FLOW_FEATURES: FlowFeature[] = [
  { id: "image", label: "Image", prompt: "Generate a lighthouse image and save the proof.", icon: Sparkles },
  { id: "swap", label: "Swap", prompt: "Swap 0.2 0G to USDC.e", icon: ArrowLeftRight },
  { id: "reverse", label: "Reverse", prompt: "Swap 0.001 USDC.e to 0G", icon: ArrowLeftRight },
  { id: "book", label: "Swap book", prompt: "What can I swap?", icon: ArrowLeftRight },
  { id: "inspect", label: "Inspect", prompt: "Inspect 0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E", icon: Boxes },
  { id: "thin", label: "Thin book", prompt: "Swap 0.01 0G to WBTC", icon: ArrowLeftRight },
  { id: "inspecttx", label: "Inspect tx", prompt: "Inspect 0x5f056d0d5c51413450a639fb1e755354b43b13917c1470d4e56ac9fe3a0e9fc9", icon: Boxes },
  { id: "analyze", label: "Analyze", prompt: "Analyze this wallet.", icon: Wallet },
  { id: "reject", label: "Wallet reject", prompt: "Wallet error: 4001 user rejected the request", icon: Shield },
  { id: "wrongnet", label: "Wrong net", prompt: "Wallet error: unrecognized chain 4902", icon: Shield },
  { id: "bridge", label: "Bridge", prompt: "How do I bridge to 0G?", icon: Landmark },
  { id: "bridgeq", label: "Bridge quote", prompt: "Bridge 1 USDC from Base to 0G", icon: Landmark },
  { id: "cheap", label: "Cheap", prompt: "Run the cheapest verified model.", icon: BarChart3 },
  { id: "research", label: "Research", prompt: "Research 0G Storage proofs and quote a cheap job.", icon: Sparkles },
  { id: "deny", label: "Denied", prompt: "Send 5 0G to this random address 0x000000000000000000000000000000000000dEaD", icon: Shield },
  { id: "why", label: "Why", prompt: "Show me why that was blocked.", icon: BadgeCheck },
  { id: "verify", label: "Verify", prompt: "Verify the last result.", icon: Boxes },
  { id: "cost", label: "Cost", prompt: "Show what the last job cost.", icon: LineChart },
  { id: "safe", label: "Safe", prompt: "Help me fund Beacon Safe and set spend policy", icon: Landmark },
  { id: "pause", label: "Pause", prompt: "Pause my Safe.", icon: Wallet },
];

type Props = {
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

export function SuggestionChips({ onSelect, disabled, className }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  function updateArrows() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  }

  return (
    <div className={cn("mb-2", className)}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous features"
          disabled={!canLeft || disabled}
          onClick={() => scrollByDir(-1)}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:text-[var(--p-fg)] disabled:opacity-25"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </button>
        <div
          ref={scrollerRef}
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scroll-smooth px-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FLOW_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <button
                key={feature.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(feature.prompt)}
                title={feature.prompt}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:bg-[var(--p-accent-soft)] hover:text-[var(--p-fg)] disabled:opacity-40"
              >
                <span className="grid size-5 place-items-center rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-text)] transition-colors group-hover:bg-[var(--p-accent)] group-hover:text-[var(--p-on-accent)]">
                  <Icon className="size-3" strokeWidth={2} />
                </span>
                {feature.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Next features"
          disabled={!canRight || disabled}
          onClick={() => scrollByDir(1)}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:text-[var(--p-fg)] disabled:opacity-25"
        >
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
