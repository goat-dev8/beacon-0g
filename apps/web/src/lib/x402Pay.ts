import type { Hex } from "viem";
import { ensureAristotleNetwork } from "./wallet";

/**
 * x402 is P2 and not the Beacon 0G job economy.
 * Native jobs lock 0G in BeaconJobEscrow. This helper refuses instead of
 * approving a USDC.e facilitator that is not wired.
 */
export async function payX402Erc20(_params: {
  amountUsdt0: string;
  payTo: string;
  token: string;
}): Promise<{
  mode: "erc20-pull";
  from: string;
  to: string;
  token: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  chainId: number;
  network: string;
  approveTxHash: Hex;
}> {
  await ensureAristotleNetwork();
  throw new Error(
    "x402 is not enabled on Beacon 0G. Jobs lock native 0G in BeaconJobEscrow.",
  );
}

/** @deprecated Use payX402Erc20 — faucet 0G has no EIP-3009. */
export const signX402Payment = payX402Erc20;
