import { describe, expect, it } from "vitest";
import { parse0g } from "@beacon/shared";
import {
  cheaperSavingsWei,
  collectSpendHashes,
  composeSpendReport,
  composeSpendWindows,
  parseSwapPrincipal,
  pickProvenJob,
  receiptGasWei,
} from "./spendAnalytics.js";

describe("spend analytics", () => {
  it("parses swap principal from activity titles without inventing amounts", () => {
    expect(parseSwapPrincipal("Beacon Safe 0G→ST0G · 0.01")).toBe(parse0g("0.01"));
    expect(parseSwapPrincipal("no amount here")).toBe(0n);
    expect(parseSwapPrincipal("x", { amountInDisplay: "0.2" })).toBe(parse0g("0.2"));
  });

  it("does not add escrow, Safe window, swap slice, and gas", () => {
    const report = composeSpendReport({
      jobs: [
        { id: "a", status: "CLOSED", lock0g: parse0g("0.001"), lockTx: "0x" + "aa".repeat(32) },
        { id: "b", status: "AUTHORIZED", lock0g: parse0g("0.001") },
        { id: "c", status: "CLOSED", lock0g: parse0g("0.001"), refundTx: "0x" + "cc".repeat(32) },
      ],
      windowSpent: parse0g("0.03"),
      activity: [{ kind: "swap", title: "Beacon Safe 0G→ST0G · 0.01" }],
      gasWei: parse0g("0.0002"),
    });
    expect(report.lanes).toHaveLength(4);
    expect(report.lanes.map((l) => l.id)).toEqual(["escrow", "safe", "swap", "gas"]);
    expect(report.lanes[0].amount0g).toBe("0.002 0G");
    expect(report.lanes[1].amount0g).toBe("0.03 0G");
    expect(report.lanes[2].amount0g).toBe("0.01 0G");
    expect(report.lanes[3].amount0g).toBe("0.0002 0G");
    expect(report.honesty).toMatch(/never add/i);
    const numeric = report.lanes.map((l) => parse0g(l.amount0g));
    expect(numeric.reduce((a, b) => a + b, 0n)).not.toBe(numeric[1]);
  });

  it("reads gas from a live-shaped receipt", () => {
    expect(receiptGasWei({ gasUsed: 100_000n, effectiveGasPrice: 4_000_000_000n })).toBe(400_000_000_000_000n);
    expect(receiptGasWei(null)).toBe(0n);
  });

  it("picks a proven job over a leftover quote", () => {
    const quoted = { id: "q", status: "QUOTED", lock0g: 1n };
    const locked = { id: "l", status: "CLOSED", lock0g: 1n, lockTx: "0x" + "aa".repeat(32) };
    expect(pickProvenJob([quoted, locked])?.id).toBe("l");
    expect(pickProvenJob([quoted])).toBeUndefined();
  });

  it("dedupes hashes from jobs and activity", () => {
    const h = "0x" + "ab".repeat(32);
    const hashes = collectSpendHashes(
      [{ id: "1", status: "CLOSED", lock0g: 1n, lockTx: h, releaseTx: h }],
      [{ kind: "swap", title: "x", ref_id: h, explorer_url: `https://chainscan.0g.ai/tx/${h}` }],
    );
    expect(hashes).toHaveLength(1);
  });

  it("shows Safe window only under Today and never invents 7d/30d vault spend", () => {
    const now = Date.parse("2026-09-02T12:00:00.000Z");
    const windows = composeSpendWindows({
      now,
      windowSpent: parse0g("0.5"),
      jobs: [
        {
          id: "today",
          status: "CLOSED",
          lock0g: parse0g("0.001"),
          createdAt: "2026-09-02T10:00:00.000Z",
        },
        {
          id: "week",
          status: "CLOSED",
          lock0g: parse0g("0.002"),
          createdAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      activity: [
        { kind: "swap", title: "Beacon Safe 0G→ST0G · 0.01", createdAt: "2026-09-02T11:00:00.000Z" },
        { kind: "swap", title: "Beacon Safe 0G→ST0G · 0.02", createdAt: "2026-08-10T11:00:00.000Z" },
      ],
      gasByHash: {},
    });
    expect(windows["1d"].lanes.find((l) => l.id === "safe")?.amount0g).toBe("0.5 0G");
    expect(windows["7d"].lanes.find((l) => l.id === "safe")?.amount0g).toBe("0 0G");
    expect(windows["30d"].lanes.find((l) => l.id === "safe")?.amount0g).toBe("0 0G");
    expect(windows["1d"].lanes.find((l) => l.id === "escrow")?.amount0g).toBe("0.001 0G");
    expect(windows["7d"].lanes.find((l) => l.id === "escrow")?.amount0g).toBe("0.003 0G");
    expect(windows["30d"].lanes.find((l) => l.id === "escrow")?.amount0g).toBe("0.003 0G");
    expect(windows["1d"].lanes.find((l) => l.id === "swap")?.amount0g).toBe("0.01 0G");
    expect(windows["7d"].lanes.find((l) => l.id === "swap")?.amount0g).toBe("0.01 0G");
    expect(windows["30d"].lanes.find((l) => l.id === "swap")?.amount0g).toBe("0.03 0G");
  });

  it("states cheaper savings in wei without inventing a comparison", () => {
    expect(cheaperSavingsWei({ lock0g: parse0g("0.01"), task: "cheap" }, parse0g("0.004"))).toBe(parse0g("0.006"));
    expect(cheaperSavingsWei({ lock0g: parse0g("0.01"), task: "image" }, parse0g("0.004"))).toBe(0n);
    expect(cheaperSavingsWei(null, parse0g("0.004"))).toBe(0n);
  });
});
