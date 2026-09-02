import { describe, expect, it } from "vitest";
import { classifyExecutionFailure } from "./walletFailures";

describe("classifyExecutionFailure", () => {
  it("maps wallet reject (4001)", () => {
    const out = classifyExecutionFailure({ code: 4001, message: "User rejected the request." });
    expect(out.kind).toBe("user_rejected");
    expect(out.message).toMatch(/nothing moved/i);
  });

  it("maps wrong network / missing chain", () => {
    const out = classifyExecutionFailure({ code: 4902, message: "Unrecognized chain" });
    expect(out.kind).toBe("wrong_network");
    expect(out.message).toMatch(/16661/);
  });

  it("maps insufficient funds vs gas", () => {
    expect(classifyExecutionFailure(new Error("insufficient funds for gas")).kind).toBe("insufficient_gas");
    expect(classifyExecutionFailure(new Error("insufficient funds")).kind).toBe("insufficient_balance");
  });

  it("maps expired quotes, TEE, compute, storage, thin book, pending bridge", () => {
    expect(classifyExecutionFailure(new Error("OFFER_EXPIRED")).kind).toBe("quote_expired");
    expect(classifyExecutionFailure(new Error("TEE_DENIED: Denied by semantic review.")).kind).toBe("tee_denied");
    expect(classifyExecutionFailure(new Error("COMPUTE_FAILED: did not return a usable result")).kind).toBe(
      "compute_failed",
    );
    expect(classifyExecutionFailure(new Error("STORAGE_FAILED: could not store evidence")).kind).toBe(
      "storage_failed",
    );
    expect(
      classifyExecutionFailure(new Error("Beacon refused this swap because verified liquidity is insufficient.")).kind,
    ).toBe("thin_book");
    expect(classifyExecutionFailure(new Error("LI.FI status is PENDING")).kind).toBe("bridge_pending");
    expect(classifyExecutionFailure(new Error("Blocked before funds moved.")).kind).toBe("policy_denied");
  });

  it("maps pending wallet requests and stale nonce", () => {
    expect(classifyExecutionFailure({ code: -32002, message: "Already processing eth_sendTransaction" }).kind).toBe(
      "request_pending",
    );
    expect(classifyExecutionFailure(new Error("nonce too low")).kind).toBe("stale_nonce");
    expect(classifyExecutionFailure({ code: 4001, message: "ACTION_REJECTED" }).kind).toBe("user_rejected");
  });
});
