import { describe, expect, it } from "vitest";
import { compositionForJob } from "./jobComposition.js";

describe("compositionForJob", () => {
  it("keeps a simple job as a single graph", () => {
    const g = compositionForJob({ status: "QUOTED" });
    expect(g.kind).toBe("single");
    expect(g.steps.some((s) => s.id === "rpc")).toBe(false);
  });

  it("adds an RPC step for analysis jobs", () => {
    const g = compositionForJob({
      serviceId: "analysis",
      status: "CLOSED",
      teeAllow: true,
      storageRoot: "0xab",
      settleTx: "0x1",
      receiptTx: "0x2",
    });
    expect(g.kind).toBe("inspect-then-job");
    expect(g.steps[0]?.id).toBe("rpc");
    expect(g.steps.every((s) => s.state === "done" || s.id === "rpc")).toBe(true);
  });
});
