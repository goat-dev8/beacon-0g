/** Zia quotes go stale. Execute must request a fresh quote — never reuse an old minOut. */

export const SWAP_QUOTE_TTL_MS = 90_000;

export function swapQuoteExpired(quotedAt: string | undefined | null, now = Date.now()): boolean {
  if (!quotedAt) return false;
  const t = Date.parse(quotedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > SWAP_QUOTE_TTL_MS;
}

export function jobPipeline(status: string | undefined | null): { label: string; pct: number } {
  const map: Record<string, { label: string; pct: number }> = {
    QUOTED: { label: "Quoted", pct: 8 },
    AUTHORIZED: { label: "Escrow locked", pct: 25 },
    PREPARING: { label: "TeeML", pct: 40 },
    GENERATING: { label: "Compute", pct: 60 },
    COMPOSING: { label: "Storage", pct: 78 },
    ACCEPTING: { label: "Accept", pct: 88 },
    PASSED: { label: "Passed", pct: 94 },
    SETTLING: { label: "Settling", pct: 97 },
    CLOSED: { label: "Released", pct: 100 },
    FAILED: { label: "Failed", pct: 100 },
    REFUSING: { label: "Refunding", pct: 100 },
    EXPIRED: { label: "Expired", pct: 100 },
    CANCELED: { label: "Canceled", pct: 100 },
  };
  if (!status) return { label: "Quoted", pct: 0 };
  return map[status] ?? { label: status, pct: 0 };
}
