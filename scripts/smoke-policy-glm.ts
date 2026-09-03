import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertZeroGRequired, loadEnv, resetEnvCache } from "@beacon/shared";
import { chatCompletions } from "@beacon/compute";
import { fetchCatalog, selectModel } from "@beacon/quote";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();
assertZeroGRequired(process.env, env);

async function main() {
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const policy = selectModel(catalog, "policy");
  const leftover52 = catalog.models.filter((m) => m.canonical_id === "glm-5.2");
  if (policy.id !== "glm-5.3" || policy.verifiability.toLowerCase() !== "teeml") {
    throw new Error(`policy must be TeeML glm-5.3, got ${policy.id} ${policy.verifiability}`);
  }
  if (!policy.address) {
    throw new Error("policy glm-5.3 missing provider address");
  }
  if (leftover52.some((m) => m.verifiability.toLowerCase() === "teeml")) {
    throw new Error("glm-5.2 still listed as TeeML — upgrade not complete");
  }

  const ping = await chatCompletions({
    model: policy.id,
    messages: [{ role: "user", content: "Reply with the single word pong." }],
    trustMode: "private",
    maxTokens: 32,
    temperature: 0,
    providerAddress: policy.address,
  });

  console.log(
    JSON.stringify({
      ok: true,
      policyModel: policy.id,
      policyVerifiability: policy.verifiability,
      trustMode: ping.trustMode,
      routerModel: ping.model,
      provider: ping.providerAddress,
      zgResKey: Boolean(ping.zgResKey),
      usage: ping.usage,
      glm52Verifiability: leftover52.map((m) => m.verifiability),
    }),
  );
  if (!ping.zgResKey) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
