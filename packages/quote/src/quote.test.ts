import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@beacon/shared";
import { catalogHash, fetchCatalog, normalizeCatalog } from "./catalog.js";
import { selectModel } from "./routeModel.js";
import { quoteJob } from "./priceJob.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "catalog.json");
const fixtureJson = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

function catalog() {
  return normalizeCatalog(fixtureJson, "2026-09-01T00:00:00.000Z");
}

describe("catalog", () => {
  it("normalizes fixture models and hashes stably", () => {
    const a = catalog();
    const b = normalizeCatalog(fixtureJson, "2026-09-01T00:00:00.000Z");
    expect(a.models.length).toBeGreaterThanOrEqual(8);
    expect(a.catalogHash).toBe(b.catalogHash);
    expect(a.catalogHash).toBe(catalogHash(a.models));
    expect(a.catalogHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fetchCatalog uses injected fetch — no network", async () => {
    const fetched = await fetchCatalog("https://router-api.0g.ai", async () => {
      return new Response(JSON.stringify(fixtureJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(fetched.models.some((m) => m.canonical_id === "glm-5.2")).toBe(true);
  });
});

describe("selectModel", () => {
  it("picks TeeML glm-5.2 for policy and never gpt", () => {
    const s = selectModel(catalog(), "policy");
    expect(s.id).toBe("glm-5.2");
    expect(s.verifiability).toBe("TeeML");
    expect(s.trustMode).toBe("private");
  });

  it("picks cheap flash before gpt", () => {
    const s = selectModel(catalog(), "cheap");
    expect(s.id).toBe("glm-5.3-flash");
    expect(s.id).not.toMatch(/gpt/i);
  });

  it("picks vision / image / stt / video ids", () => {
    expect(selectModel(catalog(), "vision").id).toBe("0gm-1.0-35b-a3b");
    expect(selectModel(catalog(), "image").id).toBe("z-image-turbo");
    expect(selectModel(catalog(), "stt").id).toBe("whisper-large-v3");
    expect(selectModel(catalog(), "video").id).toBe("bytedance/seedance-2.5");
  });

  it("does not send image models to TeeML policy review", () => {
    const policy = selectModel(catalog(), "policy");
    const image = selectModel(catalog(), "image");
    expect(policy.id).not.toBe(image.id);
    expect(policy.id).not.toMatch(/image|turbo|whisper|seedance/i);
  });
});

describe("quoteJob neurons", () => {
  it("prices policy from neurons, not USD integers", () => {
    const env = loadEnv({
      PLATFORM_FEE_BPS: "500",
      COMPUTE_BUFFER_BPS: "0",
      MIN_JOB_LOCK_0G: "0",
    });
    const q = quoteJob(
      catalog(),
      {
        task: "policy",
        briefText: "allow swap of 0.2 0G to bridged USDC",
        estimatedPromptTokens: 1000,
        estimatedCompletionTokens: 500,
      },
      env,
    );
    const expectedModel =
      5490000000000n * 1000n + 18300000000000n * 500n;
    expect(q.modelCost0g).toBe(expectedModel);
    expect(q.service0g).toBe((expectedModel * 500n) / 10_000n);
    expect(q.total0g).toBe(q.modelCost0g + q.computeBuffer0g + q.storage0g + q.service0g);
    expect(q.total0g).toBeLessThan(10n ** 18n);
    expect(q.pricingUsdHint).toContain("pricing_usd");
    expect(q.catalogHash).toBe(catalog().catalogHash);
    expect(q.quoteHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("prices an image from pricing.image neurons", () => {
    const env = loadEnv({ PLATFORM_FEE_BPS: "0", COMPUTE_BUFFER_BPS: "0", MIN_JOB_LOCK_0G: "0" });
    const q = quoteJob(catalog(), { task: "image", imageCount: 1 }, env);
    expect(q.modelCost0g).toBe(53762780000000000n);
    expect(q.lock0g).toBe(q.total0g);
  });

  it("refuses video when ENABLE_VIDEO is false", () => {
    const env = loadEnv({ ENABLE_VIDEO: "false" });
    expect(() => quoteJob(catalog(), { task: "video" }, env)).toThrow(/disabled/i);
  });
});
