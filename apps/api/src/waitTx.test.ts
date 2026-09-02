import { describe, expect, it } from "vitest";
import { AppError } from "@beacon/shared";
import { waitForMinedReceipt } from "./waitTx.js";

describe("waitForMinedReceipt", () => {
  it("returns the first successful tx.wait receipt", async () => {
    const rec = await waitForMinedReceipt(
      {
        hash: "0xabc",
        wait: async () => ({ status: 1, transactionHash: "0xabc" }),
      },
      { getTransactionReceipt: async () => null },
    );
    expect(rec.status).toBe(1);
  });

  it("polls getTransactionReceipt after Aristotle no-matching-receipts", async () => {
    let waits = 0;
    const rec = await waitForMinedReceipt(
      {
        hash: "0xebb26ae4",
        wait: async () => {
          waits += 1;
          throw new Error("no matching receipts found: this may indicate potential data corruption");
        },
      },
      {
        getTransactionReceipt: async () =>
          waits >= 2 ? { status: 1, transactionHash: "0xebb26ae4" } : null,
      },
      { delayMs: 1, sleep: async () => undefined },
    );
    expect(rec.transactionHash).toBe("0xebb26ae4");
    expect(waits).toBeGreaterThanOrEqual(2);
  });

  it("throws SETTLE_FAILED when the receipt never appears", async () => {
    await expect(
      waitForMinedReceipt(
        {
          hash: "0xdead",
          wait: async () => {
            throw new Error("no matching receipts found");
          },
        },
        { getTransactionReceipt: async () => null },
        { attempts: 3, delayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: "SETTLE_FAILED" } satisfies Partial<AppError>);
  });
});
