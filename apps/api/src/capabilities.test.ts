import { describe, expect, it } from "vitest";
import { BEACON_CAPABILITIES, capabilityCard } from "./capabilities.js";

describe("capabilities registry", () => {
  it("only lists implemented tools and includes inspect + swap + bridge catalog", () => {
    const names = BEACON_CAPABILITIES.map((c) => c.name);
    expect(names).toContain("inspect_address");
    expect(names).toContain("list_swap_assets");
    expect(names).toContain("list_bridge_routes");
    expect(names).not.toContain("generate_video");
    expect(capabilityCard().items).toHaveLength(BEACON_CAPABILITIES.length);
  });
});
