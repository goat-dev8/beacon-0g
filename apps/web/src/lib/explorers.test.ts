import { describe, expect, it } from "vitest";
import { explorerLabel, explorerTx } from "./explorers";

describe("explorers", () => {
  it("keeps Aristotle txs on chainscan.0g.ai", () => {
    expect(explorerTx("0xabc", 16661)).toContain("chainscan.0g.ai");
    expect(explorerLabel(16661)).toBe("0G Aristotle");
  });

  it("does not pretend a Base hash lives on 0G", () => {
    expect(explorerTx("0xabc", 8453)).toBe("https://basescan.org/tx/0xabc");
    expect(explorerLabel(8453)).toBe("Base");
  });
});
