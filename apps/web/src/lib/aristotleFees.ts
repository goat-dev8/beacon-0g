/** Live Aristotle EIP-1559 fees for wallet txs. Floor matches the 2 gwei RPC reject. */

export const ARISTOTLE_MIN_PRIORITY_FEE_WEI = 2_000_000_000n;

export async function aristotleEip1559Fees(oracle: {
  getGasPrice: () => Promise<bigint>;
  requestMaxPriorityFee: () => Promise<bigint>;
}): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const gasPrice = await oracle.getGasPrice();
  let tip = 0n;
  try {
    tip = await oracle.requestMaxPriorityFee();
  } catch {
    tip = 0n;
  }
  let priority = tip > ARISTOTLE_MIN_PRIORITY_FEE_WEI ? tip : ARISTOTLE_MIN_PRIORITY_FEE_WEI;
  if (gasPrice > priority) priority = gasPrice;
  return { maxFeePerGas: priority + 1_000_000n, maxPriorityFeePerGas: priority };
}
