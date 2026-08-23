import { describe, expect, it } from "vitest";
import { loadEnv } from "@beacon/shared";
import { generateImage } from "./images.js";

describe("generateImage", () => {
  it("submits async job then polls b64_json", async () => {
    const env = loadEnv({ COMPUTE_API_KEY: "sk-test", ZEROG_ROUTER_URL: "https://router-api.0g.ai" });
    let calls = 0;
    const result = await generateImage(
      { model: "z-image-turbo", prompt: "lighthouse", trustMode: "private" },
      {
        env,
        timeoutMs: 5_000,
        fetchImpl: async (url) => {
          calls += 1;
          const href = String(url);
          if (href.includes("/async/images/generations")) {
            return new Response(JSON.stringify({ jobId: "job-1", status: "pending", provider_address: "0xabc" }), {
              status: 200,
              headers: { "content-type": "application/json", "Retry-After": "0" },
            });
          }
          return new Response(
            JSON.stringify({
              status: "completed",
              data: { data: [{ b64_json: "aGVsbG8=" }] },
              x_0g_trace: { provider: "0xabc" },
            }),
            { status: 200, headers: { "content-type": "application/json", "ZG-Res-Key": "img-1" } },
          );
        },
      },
    );
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.jobId).toBe("job-1");
    expect(result.b64Json).toBe("aGVsbG8=");
    expect(result.contentHash.startsWith("0x")).toBe(true);
  });
});
