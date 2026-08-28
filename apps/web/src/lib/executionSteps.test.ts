import { describe, expect, it } from "vitest";
import { ZEROG_STEPS_SAFE, executionStepState } from "./executionSteps";

function state(id: string, status: Parameters<typeof executionStepState>[1], hasLock: boolean) {
  const step = ZEROG_STEPS_SAFE.find((s) => s.id === id);
  if (!step) throw new Error(id);
  return executionStepState(step, status, hasLock);
}

describe("executionStepState", () => {
  it("moves past Beacon Safe funded once a lock tx exists, even with no job status yet", () => {
    expect(state("safe", undefined, true)).toBe("done");
    expect(state("spend", undefined, true)).toBe("done");
    expect(state("lock", undefined, true)).toBe("done");
    expect(state("generate", undefined, true)).toBe("active");
    expect(state("accept", undefined, true)).toBe("todo");
  });

  it("keeps generate active through PREPARING / GENERATING / COMPOSING", () => {
    expect(state("generate", "AUTHORIZED", true)).toBe("active");
    expect(state("generate", "PREPARING", true)).toBe("active");
    expect(state("generate", "GENERATING", true)).toBe("active");
    expect(state("generate", "COMPOSING", true)).toBe("active");
    expect(state("generate", "ACCEPTING", true)).toBe("done");
    expect(state("accept", "ACCEPTING", true)).toBe("active");
  });

  it("does not light generate before a lock", () => {
    expect(state("safe", undefined, false)).toBe("todo");
    expect(state("generate", undefined, false)).toBe("todo");
  });
});
