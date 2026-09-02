import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it } from "vitest";
import { merkleProof, merkleRoot, verifyMerkleProof } from "./merkle.js";

function leaf(label: string): string {
  return keccak256(toUtf8Bytes(label));
}

describe("merkle", () => {
  it("uses the leaf as the root for a one-item batch", () => {
    const leaves = [leaf("job-a")];
    expect(merkleRoot(leaves)).toBe(leaves[0]);
    const proof = merkleProof(leaves, 0);
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it("proves each leaf against a multi-item batch root", () => {
    const leaves = [leaf("a"), leaf("b"), leaf("c")];
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      expect(proof.root).toBe(root);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it("rejects a tampered leaf", () => {
    const leaves = [leaf("a"), leaf("b")];
    const proof = merkleProof(leaves, 0);
    expect(verifyMerkleProof({ ...proof, leaf: leaf("forged") })).toBe(false);
  });
});
