import { describe, expect, it } from "vitest";
import { safeUrl } from "./safeUrl";

describe("safeUrl", () => {
  it("allows https links", () => {
    expect(safeUrl("https://chainscan.0g.ai/tx/0x1")).toContain("chainscan.0g.ai");
  });

  it("drops javascript and data URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
  });
});
