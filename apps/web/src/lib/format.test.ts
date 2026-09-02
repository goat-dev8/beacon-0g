import { describe, expect, it } from "vitest";
import { formatOgDisplay } from "./format";

describe("formatOgDisplay", () => {
  it("appends 0G and never prefixes $", () => {
    expect(formatOgDisplay("0.047771")).toBe("0.047771 0G");
    expect(formatOgDisplay("0.001 0G")).toBe("0.001 0G");
    expect(formatOgDisplay("$0.001")).toBe("0.001 0G");
  });

  it("treats empty as a dash", () => {
    expect(formatOgDisplay(null)).toBe("—");
    expect(formatOgDisplay("")).toBe("—");
  });
});
