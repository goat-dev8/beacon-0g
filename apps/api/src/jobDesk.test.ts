import { describe, expect, it } from "vitest";
import { serviceIdToTask } from "./jobDesk.js";

describe("serviceIdToTask", () => {
  it("maps image-like desk SKUs to the image catalog task", () => {
    expect(serviceIdToTask("image")).toBe("image");
    expect(serviceIdToTask("design")).toBe("image");
    expect(serviceIdToTask("ui")).toBe("image");
  });

  it("maps research and coding to cheap neuron quotes", () => {
    expect(serviceIdToTask("research")).toBe("cheap");
    expect(serviceIdToTask("coding")).toBe("cheap");
    expect(serviceIdToTask("documents")).toBe("cheap");
  });

  it("keeps video as video so ENABLE_VIDEO can refuse it", () => {
    expect(serviceIdToTask("video")).toBe("video");
  });
});
