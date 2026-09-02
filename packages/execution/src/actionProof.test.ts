import { ZeroHash } from "ethers";
import { describe, expect, it } from "vitest";
import { bindAction, hashPolicySnapshot, hashTeeVerdict } from "./actionProof.js";

const base = {
  chainId: 16661,
  jobId: "47c5e72b-81d8-4c84-980e-82fd78c36603",
  wallet: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
  vault: "0x6A3388D833C09a00DDbbD4e1A6c11C9623717A30",
  brief: "Say hello in one sentence.",
  policy: { maxSpendPerTx: "1000000000000000", paused: false },
  quoteHash: "0x" + "11".repeat(32),
  tee: {
    allow: true,
    reason: "ALLOW",
    chatId: "chat-1",
    recoveredSigner: "0x4C1b546f5Fc11A9c2428eaFEd1D951Aa13C17ee8",
  },
  storageRoot: "0x" + "22".repeat(32),
  lockTx: "0x" + "33".repeat(32),
  settleTx: "0x" + "44".repeat(32),
  receiptTx: "0x" + "55".repeat(32),
  nonce: 7,
  deadline: 1_800_000_000,
};

describe("bindAction", () => {
  it("is deterministic for the same fields", () => {
    const a = bindAction(base);
    const b = bindAction({ ...base, policy: { paused: false, maxSpendPerTx: "1000000000000000" } });
    expect(a.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.actionHash).toBe(b.actionHash);
    expect(a.policyHash).toBe(hashPolicySnapshot(base.policy));
    expect(a.teeHash).toBe(hashTeeVerdict(base.tee));
  });

  it("changes when the brief, policy, TEE, storage, or settlement changes", () => {
    const orig = bindAction(base).actionHash;
    expect(bindAction({ ...base, brief: "tampered" }).actionHash).not.toBe(orig);
    expect(bindAction({ ...base, policy: { ...base.policy, paused: true } }).actionHash).not.toBe(orig);
    expect(bindAction({ ...base, tee: { ...base.tee, allow: false } }).actionHash).not.toBe(orig);
    expect(bindAction({ ...base, storageRoot: "0x" + "99".repeat(32) }).actionHash).not.toBe(orig);
    expect(bindAction({ ...base, settleTx: "0x" + "aa".repeat(32) }).actionHash).not.toBe(orig);
    expect(bindAction({ ...base, nonce: 8 }).actionHash).not.toBe(orig);
  });

  it("binds missing values as zero rather than inventing a pass", () => {
    const partial = bindAction({ chainId: 16661, jobId: "pending" });
    expect(partial.storageRoot).toBe(ZeroHash);
    expect(partial.lockTx).toBe(ZeroHash);
    expect(partial.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(partial.actionHash).not.toBe(bindAction(base).actionHash);
  });
});
