import { describe, expect, it } from "vitest";
import { ZEROG_USDCE_CCIP, ZEROG_W0G, ZIA_FACTORY } from "@beacon/shared";
import { resolveZiaToken, uniqueZiaAssets } from "./tokens.js";
import { getPoolAtFee, listSwapAssets } from "./assets.js";
import { Interface, AbiCoder, getAddress } from "ethers";

describe("Zia documented tokens", () => {
  it("resolves USDC.e and WBTC from the live Zia docs table", () => {
    expect(resolveZiaToken("USDC.e")?.address.toLowerCase()).toBe(ZEROG_USDCE_CCIP.toLowerCase());
    expect(resolveZiaToken("WBTC")?.address.toLowerCase()).toBe(
      "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
    );
    expect(resolveZiaToken("0G")?.native).toBe(true);
    expect(resolveZiaToken(ZEROG_W0G)?.symbol).toBe("W0G");
    expect(uniqueZiaAssets().some((t) => t.symbol === "USDC.e")).toBe(false);
  });
});

describe("listSwapAssets", () => {
  it("only returns pairs whose factory pool quotes amountOut > 0", async () => {
    const factory = new Interface([
      "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
    ]);
    const listed = await listSwapAssets({
      now: Date.now(),
      call: async (tx) => {
        if (tx.data.startsWith(factory.getFunction("getPool")!.selector)) {
          const [, , fee] = factory.decodeFunctionData("getPool", tx.data);
          if (Number(fee) === 3000) {
            return AbiCoder.defaultAbiCoder().encode(
              ["address"],
              [getAddress("0x23336572435ec92d25ef0dd2d468b2a1abf7bb4f")],
            );
          }
          return AbiCoder.defaultAbiCoder().encode(["address"], ["0x0000000000000000000000000000000000000000"]);
        }
        return AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint160", "uint32", "uint256"],
          [1_000_000n, 0, 0, 0],
        );
      },
    });
    expect(listed.routes.length).toBeGreaterThan(0);
    expect(listed.routes.every((r) => r.quoted && r.pool)).toBe(true);
  });

  it("decodes factory getPool from a 32-byte word without ABI throw", async () => {
    const pool = getAddress("0x23336572435ec92d25ef0dd2d468b2a1abf7bb4f");
    const hit = await getPoolAtFee(
      async () => `0x${pool.slice(2).toLowerCase().padStart(64, "0")}`,
      ZIA_FACTORY,
      ZEROG_W0G,
      ZEROG_USDCE_CCIP,
      3000,
    );
    expect(hit).toBe(pool);
  });
});
