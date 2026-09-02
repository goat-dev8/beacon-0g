import { describe, expect, it } from "vitest";
import { aggregateGuards } from "./guards.js";

describe("aggregateGuards", () => {
  it("lets a hard DENY override two model ALLOWs", () => {
    const r = aggregateGuards(
      [
        { name: "firewall", allow: false, reason: "unknown selector", kind: "hard" },
        { name: "guard-a", allow: true, reason: "ALLOW", kind: "model" },
        { name: "guard-b", allow: true, reason: "ALLOW", kind: "model" },
      ],
      "MAJORITY",
    );
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/unknown selector/);
  });

  it("UNANIMOUS requires every remaining vote to ALLOW", () => {
    const r = aggregateGuards(
      [
        { name: "firewall", allow: true, reason: "ok", kind: "hard" },
        { name: "guard-a", allow: true, reason: "ALLOW", kind: "model" },
        { name: "guard-b", allow: false, reason: "uncertain", kind: "model" },
      ],
      "UNANIMOUS",
    );
    expect(r.allow).toBe(false);
  });

  it("MAJORITY can ALLOW with 2 of 3 model votes after hard ALLOW", () => {
    const r = aggregateGuards(
      [
        { name: "firewall", allow: true, reason: "ok", kind: "hard" },
        { name: "guard-a", allow: true, reason: "ALLOW", kind: "model" },
        { name: "guard-b", allow: true, reason: "ALLOW", kind: "model" },
        { name: "guard-c", allow: false, reason: "uncertain", kind: "model" },
      ],
      "MAJORITY",
    );
    expect(r.allow).toBe(true);
  });
});
