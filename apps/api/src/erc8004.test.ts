import { describe, expect, it } from "vitest";
import { encodeGiveFeedback } from "./erc8004.js";

describe("erc8004 feedback encoder", () => {
  it("encodes the uint8 score selector", () => {
    const encoded = encodeGiveFeedback(
      "giveFeedback(uint256,uint8,bytes32,bytes32,string,bytes32)",
    );
    expect(encoded).not.toBeNull();
    const data = encoded!.toData(3531902n, "https://beacon-0g.vercel.app");
    expect(data.startsWith("0x")).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it("returns null for an unknown selector", () => {
    expect(encodeGiveFeedback("nope()")).toBeNull();
  });
});
