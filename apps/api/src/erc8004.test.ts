import { describe, expect, it } from "vitest";
import { id, keccak256, toUtf8Bytes } from "ethers";
import {
  GIVE_FEEDBACK_SIGNATURE,
  canonicalFeedback,
  encodeGiveFeedback,
  encodeOfficialGiveFeedback,
  feedbackClientWallet,
  giveFeedbackSelector,
} from "./erc8004.js";

describe("erc8004 official feedback", () => {
  it("uses the 8-arg spec selector", () => {
    expect(giveFeedbackSelector()).toBe(id(GIVE_FEEDBACK_SIGNATURE).slice(0, 10));
    expect(giveFeedbackSelector()).toBe("0x3c036a7e");
  });

  it("encodes official giveFeedback with feedbackURI", () => {
    const encoded = encodeGiveFeedback(GIVE_FEEDBACK_SIGNATURE);
    expect(encoded).not.toBeNull();
    const data = encoded!.toData(3531902n, "https://beacon-0g.vercel.app/verify/demo");
    expect(data.startsWith("0x3c036a7e")).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it("returns null for a non-spec selector", () => {
    expect(encodeGiveFeedback("giveFeedback(uint256,uint8,string,bytes32)")).toBeNull();
  });

  it("hashes canonical job evidence", () => {
    const packed = canonicalFeedback({
      jobId: "5d71852d-b38f-42cd-8f53-f0fc3075c9c7",
      task: "cheap",
      outcome: "successful_job",
      proofUrl: "https://beacon-0g.vercel.app/verify/5d71852d-b38f-42cd-8f53-f0fc3075c9c7",
      releaseTx: "0x158b",
    });
    expect(packed.value).toBe(1n);
    expect(packed.tag2).toBe("successful_job");
    expect(packed.hash).toBe(keccak256(toUtf8Bytes(packed.json)));
    const data = encodeOfficialGiveFeedback({
      agentId: 3531902n,
      value: packed.value,
      tag1: packed.tag1,
      tag2: packed.tag2,
      endpoint: "https://beacon-0g-api.onrender.com/mcp",
      feedbackURI: packed.uri,
      feedbackHash: packed.hash,
    });
    expect(data.startsWith("0x3c036a7e")).toBe(true);
  });

  it("derives a client wallet that is not a zero address", () => {
    const w = feedbackClientWallet("test-session-secret-for-mcp");
    expect(w.address.startsWith("0x")).toBe(true);
    expect(w.address).not.toBe("0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf");
  });
});
