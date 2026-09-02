import { describe, expect, it } from "vitest";
import { compareResultHash, resultSha256 } from "./resultHash";

describe("resultSha256", () => {
  it("is deterministic for the same UTF-8 bytes", () => {
    const a = resultSha256("Beacon 0G");
    const b = resultSha256("Beacon 0G");
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(compareResultHash(a, a).match).toBe(true);
    expect(compareResultHash(a, "0x" + "00".repeat(32)).match).toBe(false);
  });
});
