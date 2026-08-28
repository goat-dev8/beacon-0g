import { config as loadDotenv } from "dotenv";
import { assertZeroGRequired, loadEnv } from "@beacon/shared";

loadDotenv();

/**
 * Settler: release / refund escrow and record receipts.
 * It does not retarget vaults or hold user keys.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  assertZeroGRequired(process.env, env);
  if (!env.SETTLER_PRIVATE_KEY) {
    throw new Error("SETTLER_PRIVATE_KEY is required for the settler process.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      chainId: env.CHAIN_ID,
      escrow: env.BEACON_JOB_ESCROW || null,
      receipts: env.BEACON_RECEIPT_REGISTRY || null,
      role: "settler",
    }),
  );
}

const isEntrypoint =
  process.argv[1]?.includes("settler") || process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");

if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
