import { describe, expect, it } from "vitest";
import { decryptEvidence, encryptEvidence, evidenceKeyId } from "./encrypt.js";

describe("AES-256-CTR evidence", () => {
  it("roundtrips and never embeds the key", () => {
    const key = "a".repeat(64);
    const plain = new TextEncoder().encode("prompt+result");
    const packed = encryptEvidence(plain, key);
    expect(packed.byteLength).toBeGreaterThan(plain.byteLength);
    expect(Buffer.from(packed).includes(Buffer.from(key, "hex"))).toBe(false);
    const out = decryptEvidence(packed, key);
    expect(Buffer.from(out).toString("utf8")).toBe("prompt+result");
    expect(evidenceKeyId(key)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
