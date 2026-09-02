import { describe, expect, it } from "vitest";
import { jobIdFromDeskHref, proofOutcome } from "./verifyProof";

describe("proofOutcome", () => {
  it("marks refunded jobs as REFUNDED even if status is CLOSED", () => {
    const out = proofOutcome({ status: "CLOSED", refundTx: "0xabc" }, null);
    expect(out.label).toBe("REFUNDED");
    expect(out.tone).toBe("fail");
  });

  it("requires the on-chain registry for SUCCESS", () => {
    const settled = proofOutcome(
      { status: "CLOSED", releaseTx: "0xrel" },
      null,
    );
    expect(settled.label).toBe("SETTLED");
    const success = proofOutcome(
      { status: "CLOSED", releaseTx: "0xrel" },
      { exists: true, allowed: true },
    );
    expect(success.label).toBe("SUCCESS");
    expect(success.verifiedOnChain).toBe(true);
  });
});

describe("jobIdFromDeskHref", () => {
  it("pulls a UUID from a desk link", () => {
    expect(
      jobIdFromDeskHref("/flow/desk?job=2b4fa728-54af-4c5e-9266-1fe18e74ba4b"),
    ).toBe("2b4fa728-54af-4c5e-9266-1fe18e74ba4b");
  });
});
