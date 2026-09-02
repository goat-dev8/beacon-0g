import { describe, expect, it } from "vitest";
import { recomputeActionHash } from "./actionProof.js";

const fields = {
  chainId: 16661,
  jobId: "47c5e72b-81d8-4c84-980e-82fd78c36603",
  wallet: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf" as const,
  vault: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30" as const,
  brief: "Say hello",
  policyHash: ("0x" + "11".repeat(32)) as `0x${string}`,
  quoteHash: "0x" + "22".repeat(32),
  teeHash: ("0x" + "33".repeat(32)) as `0x${string}`,
  storageRoot: "0x" + "44".repeat(32),
  lockTx: "0x" + "55".repeat(32),
  settleTx: "0x" + "66".repeat(32),
  receiptTx: "0x" + "77".repeat(32),
  nonce: "7",
  deadline: "1800000000",
};

describe("recomputeActionHash", () => {
  it("is deterministic and changes when settlement changes", () => {
    const a = recomputeActionHash(fields);
    const b = recomputeActionHash({ ...fields });
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(recomputeActionHash({ ...fields, settleTx: "0x" + "88".repeat(32) })).not.toBe(a);
  });
});
