import { describe, expect, it } from "vitest";
import { formatTokenAmount, parseSwapIntent, parseTokenAmount } from "./intent.js";

describe("parseSwapIntent", () => {
  it("parses native 0G to USDC.e", () => {
    const intent = parseSwapIntent("Swap 0.2 0G to USDC.e");
    expect(intent?.amount).toBe("0.2");
    expect(intent?.tokenIn.native).toBe(true);
    expect(intent?.tokenOut.symbol).toBe("USDC.e");
  });

  it("parses USDC.e back to 0G", () => {
    const intent = parseSwapIntent("Swap 0.001 USDC.e to 0G");
    expect(intent?.tokenIn.symbol).toBe("USDC.e");
    expect(intent?.tokenOut.native).toBe(true);
    expect(parseTokenAmount(intent!.amount, 6)).toBe(1000n);
  });

  it("parses 0G to WBTC", () => {
    const intent = parseSwapIntent("swap 0.01 0G -> WBTC");
    expect(intent?.tokenOut.symbol).toBe("WBTC");
  });

  it("returns null for an unknown token", () => {
    expect(parseSwapIntent("Swap 1 0G to FAKE")).toBeNull();
  });
});

describe("formatTokenAmount", () => {
  it("trims zeros", () => {
    expect(formatTokenAmount(1882n, 6)).toBe("0.001882");
    expect(formatTokenAmount(10n ** 18n, 18)).toBe("1");
  });
});
