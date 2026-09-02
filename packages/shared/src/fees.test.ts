import { describe, expect, it } from "vitest";
import { ARISTOTLE_MIN_PRIORITY_FEE_WEI, aristotleEip1559Fees } from "./fees.js";

describe("aristotleEip1559Fees", () => {
  it("floors a 1.5 gwei MetaMask-style tip at the live 2 gwei RPC minimum", async () => {
    const fees = await aristotleEip1559Fees({
      getGasPrice: async () => 1_500_000_000n,
      send: async () => "0x59682f00",
    });
    expect(fees.maxPriorityFeePerGas).toBe(ARISTOTLE_MIN_PRIORITY_FEE_WEI);
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas);
  });

  it("uses the live gasPrice when it is above the floor (current Aristotle ~4 gwei)", async () => {
    const fees = await aristotleEip1559Fees({
      getGasPrice: async () => 4_000_000_007n,
      send: async () => "0xee6b2800",
    });
    expect(fees.maxPriorityFeePerGas).toBe(4_000_000_007n);
    expect(fees.maxFeePerGas).toBe(4_001_000_007n);
  });
});
