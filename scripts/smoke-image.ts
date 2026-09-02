import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { loadEnv, resetEnvCache } from "@beacon/shared";
import { fetchCatalog } from "@beacon/quote";
import { quoteJob } from "@beacon/quote";
import { generateImage } from "@beacon/compute";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();

async function main() {
  if (!env.COMPUTE_API_KEY) throw new Error("COMPUTE_API_KEY required");
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const image = quoteJob(catalog, { task: "image", briefText: "lighthouse", imageCount: 1 });
  const result = await generateImage({
    model: image.modelId,
    prompt: "A single lighthouse on a dark coast, geometric, no text, night.",
    trustMode: image.selected.trustMode,
    providerAddress: image.providerAddress || undefined,
    size: "512x512",
  });
  const proof = {
    status: "REAL",
    model: result.model,
    jobId: result.jobId,
    contentHash: result.contentHash,
    zgResKeyPresent: Boolean(result.zgResKey),
    provider: result.providerAddress,
    b64Chars: result.b64Json.length,
    checkedAt: new Date().toISOString(),
  };
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/smoke-image.json");
  writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
