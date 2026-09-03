import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider } from "ethers";
import { assertZeroGRequired, CHAIN_ID, loadEnv, resetEnvCache } from "@beacon/shared";
import { fetchCatalog, selectModel } from "@beacon/quote";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();

const env = loadEnv();
assertZeroGRequired(process.env, env);

const banned = [
  ["GROQ", "API", "KEY"].join("_"),
  ["SIMULATED", "TEE"].join("_"),
  ["InMemory", "Storage"].join(""),
];
for (const key of banned) {
  if (process.env[key]) {
    console.error(`forbidden env present: ${key}`);
    process.exit(1);
  }
}

const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
const hex = await provider.send("eth_chainId", []);
if (hex !== "0x4115" || env.CHAIN_ID !== CHAIN_ID) {
  console.error("chain mismatch", hex, env.CHAIN_ID);
  process.exit(1);
}

for (const [name, addr] of Object.entries({
  escrow: env.BEACON_JOB_ESCROW,
  factory: env.BEACON_VAULT_FACTORY,
  receipts: env.BEACON_RECEIPT_REGISTRY,
  evidenceAnchor: env.BEACON_EVIDENCE_ANCHOR,
})) {
  if (!addr) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
  const code = await provider.getCode(addr);
  if (!code || code === "0x") {
    console.error(`no bytecode at ${name} ${addr}`);
    process.exit(1);
  }
}

const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
const policy = selectModel(catalog, "policy");
const glm53Tee = catalog.models.find(
  (m) => m.canonical_id === "glm-5.3" && m.verifiability.toLowerCase() === "teeml",
);
if (!glm53Tee) {
  console.error("TeeML glm-5.3 missing from live catalog");
  process.exit(1);
}
if (policy.id !== "glm-5.3" || policy.verifiability.toLowerCase() !== "teeml") {
  console.error("policy model is not TeeML glm-5.3", policy.id, policy.verifiability);
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    chainId: env.CHAIN_ID,
    ethChainId: hex,
    models: catalog.models.length,
    catalogHash: catalog.catalogHash,
    policyModel: policy.id,
    policyVerifiability: policy.verifiability,
    computeKey: Boolean(env.COMPUTE_API_KEY),
    escrow: env.BEACON_JOB_ESCROW,
  }),
);
