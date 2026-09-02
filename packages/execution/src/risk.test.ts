import { describe, expect, it } from "vitest";
import { AUTO_SWAP_WEI, classifyRisk } from "./risk.js";

describe("classifyRisk", () => {
  it("keeps a small known Zia pair AUTO", () => {
    const d = classifyRisk({
      amountWei: 10n ** 16n,
      knownPair: true,
      knownTarget: true,
      knownSelector: true,
      impactBps: 40,
    });
    expect(d.tier).toBe("AUTO");
    expect(d.needsHuman).toBe(false);
  });

  it("asks a human for high value but does not block a known pair", () => {
    const d = classifyRisk({
      amountWei: AUTO_SWAP_WEI + 1n,
      knownPair: true,
      knownTarget: true,
      knownSelector: true,
      impactBps: 50,
    });
    expect(d.tier).toBe("CONFIRM");
    expect(d.needsHuman).toBe(false);
    expect(d.reason).toMatch(/high_value/);
  });

  it("BLOCKs unknown targets and selectors", () => {
    expect(
      classifyRisk({
        amountWei: 1n,
        knownTarget: false,
        knownSelector: true,
      }).tier,
    ).toBe("BLOCK");
    expect(
      classifyRisk({
        amountWei: 1n,
        knownTarget: true,
        knownSelector: false,
      }).tier,
    ).toBe("BLOCK");
  });

  it("BLOCKs extreme slippage and CONFIRM moderate slippage", () => {
    expect(
      classifyRisk({
        amountWei: 1n,
        knownPair: true,
        knownTarget: true,
        knownSelector: true,
        impactBps: 900,
      }).tier,
    ).toBe("BLOCK");
    const mid = classifyRisk({
      amountWei: 1n,
      knownPair: true,
      knownTarget: true,
      knownSelector: true,
      impactBps: 400,
    });
    expect(mid.tier).toBe("CONFIRM");
    expect(mid.needsHuman).toBe(true);
  });

  it("escalates bridges", () => {
    const d = classifyRisk({
      amountWei: 1n,
      isBridge: true,
      knownTarget: true,
      knownSelector: true,
    });
    expect(d.tier).toBe("CONFIRM");
    expect(d.needsHuman).toBe(true);
  });
});
