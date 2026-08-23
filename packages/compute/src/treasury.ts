import { AppError, NEURONS_PER_0G, loadEnv, type BeaconEnv } from "@beacon/shared";
import { createComputeBroker } from "./broker.js";
import type { ComputeBroker, LedgerBalances } from "./types.js";

function asBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export async function readLedgerBalances(broker: ComputeBroker): Promise<LedgerBalances> {
  const ledger = await broker.ledger.getLedger();
  return {
    availableNeurons: asBig(ledger?.availableBalance),
    totalNeurons: asBig(ledger?.totalBalance),
  };
}

/**
 * Treasury-only. Tops the Compute Ledger so Router/broker inference can settle.
 * User vault 0G never enters this ledger.
 */
export async function ensureLedgerBalance(
  min0gWei: bigint,
  opts: { env?: BeaconEnv; broker?: ComputeBroker } = {},
): Promise<LedgerBalances> {
  const env = opts.env ?? loadEnv();
  const broker = opts.broker ?? (await createComputeBroker(env));
  let balances: LedgerBalances;
  try {
    balances = await readLedgerBalances(broker);
  } catch {
    balances = { availableNeurons: 0n, totalNeurons: 0n };
  }
  if (balances.availableNeurons >= min0gWei) return balances;

  const needWei = min0gWei - balances.availableNeurons;
  const needOg = Number(needWei) / Number(NEURONS_PER_0G);
  if (!Number.isFinite(needOg) || needOg <= 0) {
    throw new AppError("COMPUTE_FAILED", {
      message: "Ledger top-up amount is not a finite 0G value.",
    });
  }
  await broker.ledger.depositFund(needOg);
  return readLedgerBalances(broker);
}
