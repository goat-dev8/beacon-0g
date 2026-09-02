import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@beacon/shared";
import { normalizeCatalog } from "./catalog.js";
import { listCheapChatOptions } from "./costRoute.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "catalog.json");
const fixtureJson = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

describe("listCheapChatOptions", () => {
  it("marks the selected cheap model and lists a live alternative", () => {
    resetEnvCache();
    const env = loadEnv({
      PLATFORM_FEE_BPS: "0",
      COMPUTE_BUFFER_BPS: "0",
      MIN_JOB_LOCK_0G: "0",
    });
    const options = listCheapChatOptions(
      normalizeCatalog(fixtureJson, "2026-09-01T00:00:00.000Z"),
      "Do this as cheaply as possible.",
      env,
    );
    expect(options.length).toBeGreaterThan(1);
    expect(options.some((o) => o.selected)).toBe(true);
    expect(options.find((o) => !o.selected)).toBeTruthy();
    expect(options[0]?.lock0g).toBeGreaterThanOrEqual(0n);
  });
});
