/** Live Aristotle EIP-1559 fees. Do not hardcode a tip above the network estimate. */

/** Observed RPC rejection: tip cap 1.5 gwei < minimum 2 gwei. */
export const ARISTOTLE_MIN_PRIORITY_FEE_WEI = 2_000_000_000n;

export type FeeOracle = {
  getGasPrice: () => Promise<bigint>;
  send: (method: string, params?: unknown[]) => Promise<unknown>;
};

export type Eip1559Fees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

function asWei(raw: unknown): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  if (typeof raw === "string" && raw.length > 0) return BigInt(raw);
  return 0n;
}

/**
 * Prefer `eth_maxPriorityFeePerGas` and `eth_gasPrice`. Floor at the live 2 gwei
 * rejection threshold. Base fee on Aristotle is currently ~0 so maxFee ≈ tip.
 */
export async function aristotleEip1559Fees(oracle: FeeOracle): Promise<Eip1559Fees> {
  const gasPrice = await oracle.getGasPrice();
  let tip = 0n;
  try {
    tip = asWei(await oracle.send("eth_maxPriorityFeePerGas", []));
  } catch {
    tip = 0n;
  }
  let priority = tip > ARISTOTLE_MIN_PRIORITY_FEE_WEI ? tip : ARISTOTLE_MIN_PRIORITY_FEE_WEI;
  if (gasPrice > priority) priority = gasPrice;
  const maxFeePerGas = priority + 1_000_000n;
  return { maxFeePerGas, maxPriorityFeePerGas: priority };
}
