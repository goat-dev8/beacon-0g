import { describe, expect, it } from "vitest";
import { verifyMerkleProof } from "@beacon/receipts";
import { buildBatch } from "./evidenceBatch.js";

describe("buildBatch", () => {
  it("lets each job prove against the batch root", () => {
    const batch = buildBatch([
      { jobId: "a", actionHash: "0x" + "11".repeat(32) },
      { jobId: "b", actionHash: "0x" + "22".repeat(32) },
    ]);
    expect(verifyMerkleProof(batch.proofs.a!)).toBe(true);
    expect(verifyMerkleProof(batch.proofs.b!)).toBe(true);
    expect(batch.proofs.a!.root).toBe(batch.root);
  });
});
