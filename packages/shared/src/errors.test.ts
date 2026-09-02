import { describe, expect, it } from "vitest";
import { AppError, userMessageForCode } from "./errors.js";

describe("structured errors", () => {
  it("does not tell the user to click through a missing history database", () => {
    const msg = userMessageForCode("HISTORY_PERSISTENCE_FAILED");
    expect(msg.toLowerCase()).not.toMatch(/connect a wallet and try again/);
    expect(msg).toMatch(/database/i);
    const err = new AppError("HISTORY_PERSISTENCE_FAILED");
    expect(err.statusCode).toBe(503);
    expect(err.toJSON().error.code).toBe("HISTORY_PERSISTENCE_FAILED");
  });

  it("maps Compute ledger shortfall separately from Safe wealth", () => {
    expect(userMessageForCode("INSUFFICIENT_TREASURY")).toMatch(/not your Safe/i);
  });

  it("keeps pipeline failures honest and charge-free", () => {
    expect(userMessageForCode("TEE_DENIED")).toMatch(/refused/i);
    expect(userMessageForCode("STORAGE_FAILED")).toMatch(/Storage/i);
    expect(userMessageForCode("COMPUTE_FAILED")).toMatch(/not been charged/i);
    expect(userMessageForCode("OFFER_EXPIRED")).toMatch(/expired/i);
    expect(new AppError("SWAP_REFUSED").statusCode).toBe(400);
    expect(new AppError("TEE_DENIED").statusCode).toBe(403);
  });
});
