import type { Interface } from "ethers";

export type SimCall = {
  target: string;
  data: string;
  value?: bigint;
  maxSpend?: bigint;
};

const SELECTOR_WETH_DEPOSIT = "0xd0e30db0";
const SELECTOR_ERC20_APPROVE = "0x095ea7b3";
const SELECTOR_EXACT_INPUT_SINGLE = "0x414bf389";

function selectorOf(data: string): string {
  const hex = data.trim().toLowerCase();
  if (!hex.startsWith("0x") || hex.length < 10) return "";
  return hex.slice(0, 10);
}

function dependsOnPriorLegs(call: SimCall, prior: SimCall[]): boolean {
  const sel = selectorOf(call.data);
  if (sel !== SELECTOR_ERC20_APPROVE && sel !== SELECTOR_EXACT_INPUT_SINGLE) return false;
  return prior.some((p) => {
    const s = selectorOf(p.data);
    return s === SELECTOR_WETH_DEPOSIT || s === SELECTOR_ERC20_APPROVE;
  });
}

/**
 * eth_call of vault execute from the executor. Does not send a transaction.
 * Sequential wrap → approve → swap cannot share state across independent eth_calls.
 * A dependent-leg revert is not a hard DENY; an independent revert is.
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
  const notes: string[] = [];
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
      notes.push(`eth_call[${i}] ok`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (dependsOnPriorLegs(call, input.calls.slice(0, i))) {
        notes.push(
          `eth_call[${i}] skipped (depends on wrap/approve that has not mined; envelope still ALLOW)`,
        );
      } else {
        return { ok: false, detail: `eth_call[${i}] reverted: ${msg.slice(0, 240)}` };
      }
    }
    nonce += 1n;
  }
  return { ok: true, detail: notes.join("; ") };
}
