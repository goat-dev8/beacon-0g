import { describe, expect, it } from "vitest";
import { ARISTOTLE_MIN_PRIORITY_FEE_WEI, aristotleEip1559Fees } from "./aristotleFees";

describe("web aristotleEip1559Fees", () => {
  it("rejects the 1.5 gwei MetaMask default that Aristotle refused", async () => {
    const fees = await aristotleEip1559Fees({
      getGasPrice: async () => 1_500_000_000n,
      requestMaxPriorityFee: async () => 1_500_000_000n,
    });
    expect(fees.maxPriorityFeePerGas).toBe(ARISTOTLE_MIN_PRIORITY_FEE_WEI);
  });
});
