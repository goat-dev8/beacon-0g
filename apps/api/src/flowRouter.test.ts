import { describe, expect, it } from "vitest";
import { classifyFlowIntent } from "./flowRouter.js";

describe("classifyFlowIntent", () => {
  it("DENY unconstrained sends", () => {
    const c = classifyFlowIntent("Send 5 0G to this random address 0x000000000000000000000000000000000000dEaD");
    expect(c).toEqual({ lane: "deny", kind: "deny_unconstrained" });
  });

  it("keeps Safe balance INLINE", () => {
    expect(classifyFlowIntent("What's my Safe balance?").lane).toBe("inline");
    expect(classifyFlowIntent("What's my Safe balance?").kind).toBe("balance");
  });

  it("quotes a swap as TRANSACTION not a Job", () => {
    const c = classifyFlowIntent("Swap 0.2 0G to USDC.e");
    expect(c.lane).toBe("transaction");
    expect(c.kind).toBe("swap_quote");
  });

  it("quotes a sized bridge as TRANSACTION", () => {
    const c = classifyFlowIntent("Bridge 1 USDC from Base to 0G");
    expect(c).toEqual({ lane: "transaction", kind: "bridge_quote" });
  });

  it("bridge how-to stays INLINE catalog", () => {
    expect(classifyFlowIntent("How do I bridge to 0G?")).toEqual({ lane: "inline", kind: "bridge_info" });
  });

  it("image generation is a JOB", () => {
    expect(classifyFlowIntent("Generate a lighthouse image")).toEqual({ lane: "job", kind: "image_job" });
  });

  it("why-blocked and spend stay INLINE", () => {
    expect(classifyFlowIntent("Why was this blocked?").kind).toBe("why_blocked");
    expect(classifyFlowIntent("How much did I spend?").kind).toBe("spend");
  });

  it("cheap model routing is a JOB", () => {
    expect(classifyFlowIntent("Do this cheaper.").kind).toBe("cheap_model");
  });

  it("live RPC inspect stays INLINE; analyze/explain is a JOB", () => {
    expect(classifyFlowIntent("Inspect 0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E")).toEqual({
      lane: "inline",
      kind: "inspect_address",
    });
    expect(classifyFlowIntent("Inspect 0x" + "ab".repeat(32)).kind).toBe("inspect_tx");
    expect(classifyFlowIntent("Analyze this wallet.")).toEqual({
      lane: "job",
      kind: "analysis_job",
    });
    expect(
      classifyFlowIntent("Explain 0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E from the live evidence."),
    ).toEqual({ lane: "job", kind: "analysis_job" });
  });

  it("pasted wallet errors stay INLINE and do not become Jobs", () => {
    expect(classifyFlowIntent("Wallet error: 4001 user rejected the request")).toEqual({
      lane: "inline",
      kind: "wallet_error",
    });
    expect(classifyFlowIntent("Wallet error: unrecognized chain 4902")).toEqual({
      lane: "inline",
      kind: "wallet_error",
    });
  });
});
