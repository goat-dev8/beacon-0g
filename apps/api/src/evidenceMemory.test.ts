import { describe, expect, it } from "vitest";
import { recallEvidence } from "./evidenceMemory.js";

describe("recallEvidence", () => {
  const now = Date.parse("2026-09-02T20:00:00Z");

  it("answers from jobs + activity with Storage and explorer citations", () => {
    const rec = recallEvidence({
      nowMs: now,
      question: "What did I do last week?",
      jobs: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          status: "CLOSED",
          createdAt: "2026-09-01T12:00:00Z",
          storageRoot: "0x" + "ab".repeat(32),
          releaseTx: "0x" + "11".repeat(32),
          receiptTx: "0x" + "22".repeat(32),
          quote: { modelId: "qwen3.8-flash", lock0gDisplay: "0.001 0G" },
        },
      ],
      activity: [
        {
          kind: "swap",
          title: "MCP swap · 0.01 0G → USDC",
          created_at: "2026-09-01T18:00:00Z",
          explorer_url: "https://chainscan.0g.ai/tx/0xabc",
          ref_id: "swap-1",
        },
      ],
    });
    expect(rec.citations).toHaveLength(2);
    expect(rec.citations[0]?.verify).toBe("/verify/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(rec.citations[0]?.storageRoot).toMatch(/^0xab/);
    expect(rec.answer).toMatch(/2 evidence-backed/);
    expect(rec.source).toBe("history+jobs+receipts");
  });

  it("does not invent memory when nothing is on file", () => {
    const rec = recallEvidence({
      nowMs: now,
      question: "What did I do last week?",
      jobs: [],
      activity: [],
    });
    expect(rec.citations).toEqual([]);
    expect(rec.answer).toMatch(/will not invent/);
  });

  it("drops records outside the window", () => {
    const rec = recallEvidence({
      nowMs: now,
      question: "What did I do today?",
      jobs: [
        {
          id: "old",
          status: "CLOSED",
          createdAt: "2026-08-01T00:00:00Z",
          storageRoot: "0x" + "cd".repeat(32),
        },
      ],
      activity: [],
    });
    expect(rec.citations).toEqual([]);
  });
});
