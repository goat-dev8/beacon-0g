import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider } from "ethers";
import { assertZeroGRequired, CHAIN_ID, loadEnv, parse0g, resetEnvCache } from "@beacon/shared";
import { fetchCatalog } from "@beacon/quote";
import { quoteExactIn } from "@beacon/swap";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();

const env = loadEnv();
assertZeroGRequired(process.env, env);

const hostedApi =
  process.env.BEACON_API_URL ||
  (env.API_URL.includes("localhost") || env.API_URL.includes("127.0.0.1")
    ? "https://beacon-0g-api.onrender.com"
    : env.API_URL);
const API = hostedApi.replace(/\/$/, "");
const WEB = process.env.BEACON_WEB_URL || "https://beacon-0g.vercel.app";

function redact(value: unknown): unknown {
  if (typeof value === "string" && (value.includes("postgres://") || value.startsWith("sk-") || value.startsWith("ghp_"))) {
    return "[redacted]";
  }
  return value;
}

async function getJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJson: true, status: res.status };
  }
  return { status: res.status, json };
}

const banned = [
  ["GROQ", "API", "KEY"].join("_"),
  ["SIMULATED", "TEE"].join("_"),
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

const catalog = await fetchCatalog(env.ZEROG_ROUTER_URL);
if (!catalog.models.some((m) => m.canonical_id.includes("z-image"))) {
  console.error("no z-image model in live catalog");
  process.exit(1);
}

let zia: { amountOut: string; impactBps: number } | { refused: string };
try {
  const quote = await quoteExactIn(parse0g("0.01"));
  zia = { amountOut: quote.amountOut.toString(), impactBps: quote.impactBps };
} catch (err) {
  zia = { refused: err instanceof Error ? err.message : "swap refused" };
}

const health = await getJson(`${API}/health`);
const ready = await getJson(`${API}/ready`);
const web = await fetch(WEB);
const healthJson = health.json as { history?: boolean; chainId?: number; ok?: boolean };
const readyJson = ready.json as { history?: boolean; settler?: boolean; computeKey?: boolean };

const report = {
  ok: health.status === 200 && web.ok && healthJson.chainId === CHAIN_ID,
  api: API,
  web: WEB,
  chainId: env.CHAIN_ID,
  ethChainId: hex,
  models: catalog.models.length,
  catalogHash: catalog.catalogHash,
  history: Boolean(healthJson.history),
  settler: Boolean(readyJson.settler),
  computeKey: Boolean(readyJson.computeKey),
  zia,
  healthStatus: health.status,
  webStatus: web.status,
};
console.log(JSON.stringify(report));
if (!report.ok) process.exit(1);
if (!report.history) {
  console.error("production history is offline");
  process.exit(2);
}
void redact;
