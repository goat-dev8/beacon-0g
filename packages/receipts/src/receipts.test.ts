import { describe, expect, it } from "vitest";
import { buildReceipt, validateReceipt } from "./build.js";

describe("0G receipts", () => {
  it("stores amount0g, storageRoot, teeSigner, quoteHash — not USDT0", () => {
    const receipt = buildReceipt({
      jobId: "job-1",
      serviceId: "infer",
      offer: {
        offerId: "off-1",
        briefHash: "0x01",
        rubricHash: "0x02",
        quoteHash: "0xabc",
        amount0g: "13000000000000000",
        modelId: "glm-5.2",
      },
      accept: {
        acceptId: "acc-1",
        result: "PASS",
        confidence: 1,
        summary: "ok",
      },
      payment: {
        paymentId: "pay-1",
        settled: true,
        amount0g: "13000000000000000",
      },
      storageRoot: "0xstor",
      teeSigner: "0x1111111111111111111111111111111111111111",
      chatIdHash: "0xchat",
      quoteHash: "0xabc",
    });
    expect(receipt.chainId).toBe(16661);
    expect(receipt.payment.amount0g).toBe("13000000000000000");
    expect(receipt.proof.storageRoot).toBe("0xstor");
    expect(receipt.proof.teeSigner).toMatch(/^0x/);
    expect(receipt.proof.quoteHash).toBe("0xabc");
    expect(receipt.display.priceDisplay).toContain("0G");
    expect(JSON.stringify(receipt)).not.toMatch(/USDT0/i);
    expect(validateReceipt(receipt).valid).toBe(true);
  });
});
