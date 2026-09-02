import { merkleProof, merkleRoot, type MerkleProof } from "@beacon/receipts";

export type PendingLeaf = {
  jobId: string;
  actionHash: string;
};

export function buildBatch(leaves: PendingLeaf[]): {
  root: string;
  proofs: Record<string, MerkleProof>;
} {
  const hashes = leaves.map((l) => l.actionHash);
  const root = merkleRoot(hashes);
  const proofs: Record<string, MerkleProof> = {};
  leaves.forEach((leaf, index) => {
    proofs[leaf.jobId] = merkleProof(hashes, index);
  });
  return { root, proofs };
}
