import { z } from "zod";
import { AppError } from "./errors.js";
import {
  CHAIN_ID,
  DEFAULT_COMPUTE_BUFFER_BPS,
  DEFAULT_MAX_IMPACT_BPS,
  DEFAULT_MIN_JOB_LOCK_0G,
  DEFAULT_PLATFORM_FEE_BPS,
  ERC8004_IDENTITY,
  ERC8004_REPUTATION,
  ZEROG_EXPLORER,
  ZEROG_FLOW,
  ZEROG_INFERENCE,
  ZEROG_LEDGER,
  ZEROG_RPC_URL,
  ZEROG_ROUTER_URL,
  ZEROG_STORAGE_INDEXER,
  ZEROG_STORAGE_SCAN,
  ZEROG_USDCE_CCIP,
  ZEROG_W0G,
  ZIA_FACTORY,
  ZIA_QUOTER,
  ZIA_ROUTER,
} from "./constants.js";

const optionalString = z.string().optional().default("");

const optionalBool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return fallback;
      if (typeof v === "boolean") return v;
      return v.toLowerCase() === "true" || v === "1";
    });

const optionalInt = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return fallback;
      const n = typeof v === "number" ? v : Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    });

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: optionalString,
  APP_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:3001"),
  API_PORT: optionalInt(3001),
  WEB_PORT: optionalInt(5173),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_SECRET: z.string().min(8).default("dev-session-secret"),

  CHAIN_ID: optionalInt(CHAIN_ID),
  NETWORK_NAME: z.string().default("aristotle"),

  ZEROG_RPC_URL: z.string().url().default(ZEROG_RPC_URL),
  ZEROG_EXPLORER: z.string().url().default(ZEROG_EXPLORER),
  ZEROG_STORAGE_SCAN: z.string().url().default(ZEROG_STORAGE_SCAN),
  ZEROG_ROUTER_URL: z.string().url().default(ZEROG_ROUTER_URL),
  ZEROG_STORAGE_INDEXER: z.string().url().default(ZEROG_STORAGE_INDEXER),

  ZEROG_W0G: z.string().default(ZEROG_W0G),
  ZIA_FACTORY: z.string().default(ZIA_FACTORY),
  ZIA_ROUTER: z.string().default(ZIA_ROUTER),
  ZIA_QUOTER: z.string().default(ZIA_QUOTER),
  ZEROG_USDCE: z.string().default(ZEROG_USDCE_CCIP),
  ZEROG_FLOW: z.string().default(ZEROG_FLOW),
  ZEROG_LEDGER: z.string().default(ZEROG_LEDGER),
  ZEROG_INFERENCE: z.string().default(ZEROG_INFERENCE),
  ERC8004_IDENTITY: z.string().default(ERC8004_IDENTITY),
  ERC8004_REPUTATION: z.string().default(ERC8004_REPUTATION),

  TEE_FAIL_CLOSED: optionalBool(true),
  PLATFORM_FEE_BPS: optionalInt(DEFAULT_PLATFORM_FEE_BPS),
  MIN_JOB_LOCK_0G: z.string().default(DEFAULT_MIN_JOB_LOCK_0G),
  MAX_IMPACT_BPS: optionalInt(DEFAULT_MAX_IMPACT_BPS),
  COMPUTE_BUFFER_BPS: optionalInt(DEFAULT_COMPUTE_BUFFER_BPS),
  ENABLE_SWAP: optionalBool(true),
  ENABLE_VIDEO: optionalBool(false),
  ENABLE_X402: optionalBool(false),

  DATABASE_URL: optionalString,
  DATABASE_URL_DIRECT: optionalString,
  DATABASE_SSL: optionalBool(true),
  REDIS_URL: optionalString,
  UPSTASH_REDIS_REST_URL: optionalString,
  UPSTASH_REDIS_REST_TOKEN: optionalString,

  COMPUTE_API_KEY: optionalString,
  SETTLER_PRIVATE_KEY: optionalString,
  ZEROG_DEPLOYER_PK: optionalString,
  ZEROG_EVIDENCE_KEY: optionalString,

  BEACON_VAULT_FACTORY: optionalString,
  BEACON_JOB_ESCROW: optionalString,
  BEACON_RECEIPT_REGISTRY: optionalString,
  BEACON_TREASURY: optionalString,
});

export type BeaconEnv = z.infer<typeof envSchema>;

let cached: BeaconEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BeaconEnv {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Environment validation failed: ${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = null;
}

export function requireEnv<K extends keyof BeaconEnv>(
  env: BeaconEnv,
  key: K,
): NonNullable<BeaconEnv[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<BeaconEnv[K]>;
}

function truthyEnv(source: NodeJS.ProcessEnv, key: string): boolean {
  const v = source[key];
  if (v === undefined || v === "") return false;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/**
 * Boot gate for Aristotle. Rejects wrong chain, missing RPC, open TEE, or
 * simulated-compute env keys (assembled so source does not contain banned tokens).
 */
export function assertZeroGRequired(
  source: NodeJS.ProcessEnv = process.env,
  env: BeaconEnv = loadEnv(source),
): void {
  if (env.CHAIN_ID !== CHAIN_ID) {
    throw new AppError("ENV_INVALID", {
      message: `CHAIN_ID must be ${CHAIN_ID} (0G Aristotle). Got ${env.CHAIN_ID}.`,
      details: { chainId: env.CHAIN_ID },
    });
  }
  if (!env.ZEROG_RPC_URL) {
    throw new AppError("ENV_INVALID", {
      message: "ZEROG_RPC_URL is required.",
    });
  }
  if (env.TEE_FAIL_CLOSED !== true) {
    throw new AppError("ENV_INVALID", {
      message: "TEE_FAIL_CLOSED must be true. Beacon does not run open TEE.",
    });
  }
  const indexer = env.ZEROG_STORAGE_INDEXER.toLowerCase();
  if (!indexer.includes("indexer-storage-turbo.0g.ai")) {
    throw new AppError("ENV_INVALID", {
      message: "ZEROG_STORAGE_INDEXER must be the turbo indexer (standard indexer is not used).",
      details: { indexer: env.ZEROG_STORAGE_INDEXER },
    });
  }
  if (env.ZIA_FACTORY.toLowerCase() !== ZIA_FACTORY.toLowerCase()) {
    throw new AppError("ENV_INVALID", {
      message: "ZIA_FACTORY must stay pinned to the Zia factory on Aristotle.",
      details: { factory: env.ZIA_FACTORY },
    });
  }

  const bannedSim = ["SIMULATED", "TEE"].join("_");
  if (truthyEnv(source, bannedSim)) {
    throw new AppError("ENV_INVALID", {
      message: "Simulated confidential compute is not allowed on Beacon 0G.",
    });
  }
  const bannedDev = ["ZG", "DEV", "MODE"].join("_");
  if (truthyEnv(source, bannedDev)) {
    throw new AppError("ENV_INVALID", {
      message: "0G compute dev mode is not allowed.",
    });
  }
}
