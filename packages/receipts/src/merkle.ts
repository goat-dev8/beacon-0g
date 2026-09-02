import { keccak256, concat, getBytes } from "ethers";

export type MerkleProof = {
  leaf: string;
  index: number;
  siblings: string[];
  root: string;
};

function norm(value: string): string {
  const v = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(v)) {
    throw new Error("Merkle leaf must be a 32-byte hex hash.");
  }
  return v;
}

function parent(a: string, b: string): string {
  const left = getBytes(a);
  const right = getBytes(b);
  const [lo, hi] = Buffer.compare(Buffer.from(left), Buffer.from(right)) <= 0 ? [a, b] : [b, a];
  return keccak256(concat([lo, hi])).toLowerCase();
}

/** Sorted-pair keccak Merkle tree. A single leaf is its own root. */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    throw new Error("Merkle tree needs at least one leaf.");
  }
  let layer = leaves.map(norm);
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1] ?? a;
      next.push(parent(a, b));
    }
    layer = next;
  }
  return layer[0]!;
}

export function merkleProof(leaves: string[], index: number): MerkleProof {
  const normalized = leaves.map(norm);
  if (index < 0 || index >= normalized.length) {
    throw new Error("Leaf index out of range.");
  }
  const siblings: string[] = [];
  let layer = normalized;
  let idx = index;
  while (layer.length > 1) {
    const pair = idx ^ 1;
    siblings.push(layer[pair] ?? layer[idx]!);
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1] ?? a;
      next.push(parent(a, b));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return {
    leaf: normalized[index]!,
    index,
    siblings,
    root: layer[0]!,
  };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  try {
    let hash = norm(proof.leaf);
    let idx = proof.index;
    for (const sibling of proof.siblings) {
      hash = parent(hash, norm(sibling));
      idx = Math.floor(idx / 2);
    }
    return hash === norm(proof.root);
  } catch {
    return false;
  }
}
