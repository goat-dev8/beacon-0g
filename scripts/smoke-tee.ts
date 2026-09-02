import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { assertZeroGRequired, loadEnv, resetEnvCache } from "@beacon/shared";
import { chatCompletions, createComputeBroker, usageJson } from "@beacon/compute";
import { proveTeeIndependently } from "@beacon/tee";
import { fetchCatalog, quoteJob } from "@beacon/quote";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();
assertZeroGRequired(process.env, env);

async function main() {
  const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
  const cheap = quoteJob(catalog, { task: "cheap", briefText: "tee ping" });
  const ping = await chatCompletions({
    model: cheap.modelId,
    messages: [{ role: "user", content: "Reply with the single word pong." }],
    trustMode: cheap.selected.trustMode,
    maxTokens: 8,
    providerAddress: cheap.providerAddress || undefined,
  });
  if (!ping.providerAddress || !ping.zgResKey) {
    throw new Error("missing provider or ZG-Res-Key");
  }
  const broker = await createComputeBroker(env);
  const proof = await proveTeeIndependently({
    providerAddress: ping.providerAddress,
    chatId: ping.zgResKey,
    model: ping.model,
    env,
    processResponse: () =>
      broker.inference!.processResponse(
        ping.providerAddress!,
        ping.zgResKey!,
        usageJson(ping.usage),
      ),
  });
  const out = {
    model: ping.model,
    provider: ping.providerAddress,
    chatIdPresent: Boolean(ping.zgResKey),
    processResponse: proof.processResponse,
    eip191Ok: proof.eip191Ok,
    recoveredSigner: proof.recoveredSigner,
    expectedSigner: proof.expectedSigner,
    signatureUrlHost: proof.signatureUrl ? new URL(proof.signatureUrl).host : null,
  };
  console.log(JSON.stringify(out));
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/smoke-tee.json"), JSON.stringify(out, null, 2));
  if (proof.processResponse !== true || proof.eip191Ok !== true) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
