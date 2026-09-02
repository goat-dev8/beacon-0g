import { NETWORK } from "./chain";

const BY_CHAIN: Record<number, { origin: string; label: string }> = {
  16661: { origin: NETWORK.explorer, label: "0G Aristotle" },
  8453: { origin: "https://basescan.org", label: "Base" },
  1: { origin: "https://etherscan.io", label: "Ethereum" },
  56: { origin: "https://bscscan.com", label: "BNB Chain" },
};

function meta(chainId?: number | string | null) {
  const id = Number(chainId ?? 16661);
  return BY_CHAIN[id] ?? BY_CHAIN[16661];
}

export function explorerForChain(chainId?: number | string | null): string {
  return meta(chainId).origin;
}

export function explorerTx(hash: string, chainId?: number | string | null): string {
  return `${meta(chainId).origin}/tx/${hash}`;
}

export function explorerAddress(address: string, chainId?: number | string | null): string {
  return `${meta(chainId).origin}/address/${address}`;
}

export function explorerLabel(chainId?: number | string | null): string {
  return meta(chainId).label;
}

export function storageScan(root: string): string {
  return `${NETWORK.storageScan}/?root=${root}`;
}
