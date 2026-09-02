import { AbiCoder, Interface, getAddress, solidityPacked } from "ethers";
import { describe, expect, it } from "vitest";
import {
  EXACT_INPUT_SINGLE_SELECTOR,
  ZEROG_USDCE_CCIP,
  ZEROG_W0G,
  ZIA_DEFAULT_FEE,
  loadEnv,
} from "@beacon/shared";
import { encodeV3Path } from "./path.js";
import {
  THIN_LIQUIDITY,
  quoteExactIn,
  quoteZiaPair,
  buildSwapTx,
  encodeExactInputSingle,
  exactInputSingleSelector,
} from "./zia.js";

const env = loadEnv({
  ZEROG_USDCE: ZEROG_USDCE_CCIP,
  ZEROG_W0G,
  ENABLE_SWAP: "true",
  MAX_IMPACT_BPS: "300",
});

function encodeQuoteReturn(amountOut: bigint): string {
  return AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint160", "uint32", "uint256"],
    [amountOut, 0, 0, 0],
  );
}

describe("zia path", () => {
  it("encodes tokenIn || fee24 || tokenOut", () => {
    const path = encodeV3Path(ZEROG_W0G, ZIA_DEFAULT_FEE, ZEROG_USDCE_CCIP);
    const packed = solidityPacked(
      ["address", "uint24", "address"],
      [getAddress(ZEROG_W0G), ZIA_DEFAULT_FEE, getAddress(ZEROG_USDCE_CCIP)],
    );
    expect(path).toBe(packed);
    expect(path.length).toBe(2 + 20 * 2 + 3 * 2 + 20 * 2);
  });
});

describe("exactInputSingle", () => {
  it("selector is 0x414bf389", () => {
    expect(exactInputSingleSelector().toLowerCase()).toBe(EXACT_INPUT_SINGLE_SELECTOR);
    const data = encodeExactInputSingle({
      tokenIn: ZEROG_W0G,
      tokenOut: ZEROG_USDCE_CCIP,
      fee: 3000,
      recipient: "0x0000000000000000000000000000000000000001",
      deadline: 1n,
      amountIn: 1n,
      amountOutMinimum: 1n,
    });
    expect(data.slice(0, 10).toLowerCase()).toBe(EXACT_INPUT_SINGLE_SELECTOR);
  });
});

describe("quoteExactIn", () => {
  it("refuses amountOut=0 with the product message", async () => {
    await expect(
      quoteExactIn(2n * 10n ** 18n, {
        env,
        call: async () => encodeQuoteReturn(0n),
      }),
    ).rejects.toThrow(THIN_LIQUIDITY);
  });

  it("returns amountOut, impact, minOut from eth_call", async () => {
    const amountIn = 2n * 10n ** 18n;
    const q = await quoteExactIn(amountIn, {
      env,
      slippageBps: 50,
      probeWei: 10n ** 15n,
      call: async (tx) => {
        const decoded = new Interface([
          "function quoteExactInput(bytes path, uint256 amountIn)",
        ]).decodeFunctionData("quoteExactInput", tx.data);
        const ain = BigInt(decoded[1]);
        const out = (ain * 244n) / 1000n / 10n ** 12n;
        return encodeQuoteReturn(out);
      },
    });
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.minOut).toBeLessThanOrEqual(q.amountOut);
    expect(q.tokenOut.toLowerCase()).toBe(ZEROG_USDCE_CCIP.toLowerCase());
    expect(q.fee).toBe(3000);
  });

  it("refuses impact above MAX_IMPACT_BPS", async () => {
    const tight = loadEnv({
      ZEROG_USDCE: ZEROG_USDCE_CCIP,
      ZEROG_W0G,
      ENABLE_SWAP: "true",
      MAX_IMPACT_BPS: "10",
    });
    await expect(
      quoteExactIn(2n * 10n ** 18n, {
        env: tight,
        probeWei: 10n ** 15n,
        call: async (tx) => {
          const decoded = new Interface([
            "function quoteExactInput(bytes path, uint256 amountIn)",
          ]).decodeFunctionData("quoteExactInput", tx.data);
          const ain = BigInt(decoded[1]);
          if (ain === 10n ** 15n) return encodeQuoteReturn(10n ** 6n);
          return encodeQuoteReturn(1n);
        },
      }),
    ).rejects.toThrow(THIN_LIQUIDITY);
  });
});

describe("quoteZiaPair", () => {
  it("quotes reverse USDC.e → 0G but refuses Safe execution", async () => {
    const q = await quoteZiaPair({
      amountIn: 1000n,
      tokenIn: "USDC.e",
      tokenOut: "0G",
      env,
      probeWei: 0n,
      call: async () => encodeQuoteReturn(10n ** 15n),
    });
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.executableFromSafe).toBe(false);
    expect(q.executeBlock).toMatch(/unexpected credit/i);
  });

  it("marks native 0G → USDC as Safe-executable", async () => {
    const q = await quoteZiaPair({
      amountIn: 10n ** 18n,
      tokenIn: "0G",
      tokenOut: "USDC",
      env,
      probeWei: 0n,
      call: async () => encodeQuoteReturn(200_000n),
    });
    expect(q.wrapNative).toBe(true);
    expect(q.executableFromSafe).toBe(true);
  });
});

describe("buildSwapTx", () => {
  it("builds deposit + approve + exactInputSingle for the vault", async () => {
    const quote = await quoteExactIn(10n ** 18n, {
      env,
      probeWei: 0n,
      call: async () => encodeQuoteReturn(200_000n),
    });
    const built = buildSwapTx(quote, "0x00000000000000000000000000000000000000aa");
    expect(built.calls).toHaveLength(3);
    expect(built.calls[2].selector.toLowerCase()).toBe(EXACT_INPUT_SINGLE_SELECTOR);
    expect(built.calls[2].target.toLowerCase()).toBe(quote.router.toLowerCase());
    expect(built.calls[2].maxSpend).toBe(quote.amountIn);
    expect(built.calls[0].maxSpend).toBe(0n);
    expect(built.calls[1].maxSpend).toBe(0n);
    expect(built.calls[0].value).toBe(quote.amountIn);
  });

  it("skips W0G deposit when wrapNative is false", async () => {
    const quote = await quoteZiaPair({
      amountIn: 10n ** 18n,
      tokenIn: "W0G",
      tokenOut: "USDC",
      env,
      probeWei: 0n,
      call: async () => encodeQuoteReturn(200_000n),
    });
    const built = buildSwapTx(quote, "0x00000000000000000000000000000000000000aa", { wrapNative: false });
    expect(built.calls).toHaveLength(2);
    expect(built.calls[0].value).toBe(0n);
  });
});
