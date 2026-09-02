import type { Interface } from "ethers";

export type SimCall = {
  target: string;
  data: string;
  value?: bigint;
  maxSpend?: bigint;
};

/**
 * eth_call of vault execute from the executor. Does not send a transaction.
 * Fail-closed: any revert is DENY.
 */
export async function simulateVaultCalls(input: {
  call: (tx: { from: string; to: string; data: string }) => Promise<unknown>;
  vaultAbi: Interface;
  safe: string;
  executor: string;
  calls: SimCall[];
  nonce: bigint;
}): Promise<{ ok: boolean; detail: string }> {
  if (!input.executor || !input.safe) {
    return { ok: false, detail: "Executor or Safe missing for simulation" };
  }
  let nonce = input.nonce;
  for (const [i, call] of input.calls.entries()) {
    try {
      await input.call({
        from: input.executor,
        to: input.safe,
        data: input.vaultAbi.encodeFunctionData("execute", [
          call.target,
          call.data,
          call.maxSpend ?? 0n,
          nonce,
          call.value ?? 0n,
        ]),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `eth_call[${i}] reverted: ${msg.slice(0, 240)}` };
    }
    nonce += 1n;
  }
  return { ok: true, detail: `eth_call succeeded for ${input.calls.length} vault execute(s)` };
}
