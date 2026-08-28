import { NETWORK } from "@/lib/chain";

export function explorerForChain(_chainId?: number | string | null): string {
  return NETWORK.explorer;
}

export function explorerTx(hash: string, _chainId?: number | string | null): string {
  return `${NETWORK.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string, _chainId?: number | string | null): string {
  return `${NETWORK.explorer}/address/${address}`;
}

export function explorerLabel(_chainId?: number | string | null): string {
  return "0G Aristotle";
}

export function storageScan(root: string): string {
  return `${NETWORK.storageScan}/?root=${root}`;
}
