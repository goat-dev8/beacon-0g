import { describe, expect, it } from "vitest";
import { jobPipeline, SWAP_QUOTE_TTL_MS, swapQuoteExpired } from "./quoteFreshness";

describe("swapQuoteExpired", () => {
  it("keeps a fresh quote executable", () => {
    const now = Date.parse("2026-09-02T05:00:00.000Z");
    expect(swapQuoteExpired("2026-09-02T04:59:30.000Z", now)).toBe(false);
  });

  it("refuses a quote older than the TTL", () => {
    const now = Date.parse("2026-09-02T05:00:00.000Z");
    expect(swapQuoteExpired("2026-09-02T04:58:00.000Z", now)).toBe(true);
    expect(SWAP_QUOTE_TTL_MS).toBe(90_000);
  });
});

describe("jobPipeline", () => {
  it("maps lock → compute → storage → release", () => {
    expect(jobPipeline("AUTHORIZED").label).toMatch(/Escrow/);
    expect(jobPipeline("GENERATING").pct).toBeGreaterThan(jobPipeline("AUTHORIZED").pct);
    expect(jobPipeline("CLOSED").pct).toBe(100);
  });
});
