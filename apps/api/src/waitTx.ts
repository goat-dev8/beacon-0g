import { AppError } from "@beacon/shared";

export type ReceiptLike = {
  status?: number | bigint | string | null;
  hash?: string;
  transactionHash?: string;
};

export type WaitableTx = {
  hash: string;
  wait: (confirms?: number) => Promise<ReceiptLike | null>;
};

export type ReceiptProvider = {
  getTransactionReceipt: (hash: string) => Promise<ReceiptLike | null>;
};

/** Aristotle sometimes answers eth_getTransactionReceipt with -32000 "no matching receipts" while the tx is already mined. */
export const TRANSIENT_RECEIPT_ERROR =
  /no matching receipts|could not coalesce|missing revert data|NETWORK_ERROR|ETIMEDOUT|ECONNRESET|timeout|server error/i;

export async function waitForMinedReceipt(
  tx: WaitableTx,
  rpc: ReceiptProvider,
  opts?: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<ReceiptLike> {
  const attempts = opts?.attempts ?? 16;
  const delayMs = opts?.delayMs ?? 1500;
  const sleep = opts?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const mined = await tx.wait();
      if (mined) return mined;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_RECEIPT_ERROR.test(msg)) {
        const rec = await readReceipt(rpc, tx.hash);
        if (rec) return rec;
        throw err;
      }
    }
    const rec = await readReceipt(rpc, tx.hash);
    if (rec) return rec;
    await sleep(delayMs);
  }

  const rec = await readReceipt(rpc, tx.hash);
  if (rec) return rec;
  const detail = lastErr instanceof Error ? lastErr.message : "receipt missing";
  throw new AppError("SETTLE_FAILED", {
    message: `Transaction ${tx.hash} was submitted but Aristotle RPC did not return a receipt (${detail}).`,
  });
}

async function readReceipt(rpc: ReceiptProvider, hash: string): Promise<ReceiptLike | null> {
  try {
    return await rpc.getTransactionReceipt(hash);
  } catch {
    return null;
  }
}
