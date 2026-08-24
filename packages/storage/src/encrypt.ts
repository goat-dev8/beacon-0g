import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { AppError } from "@beacon/shared";

const IV_LEN = 16;

export function evidenceKeyBytes(keyMaterial: string): Buffer {
  if (!keyMaterial) {
    throw new AppError("STORAGE_FAILED", {
      message: "ZEROG_EVIDENCE_KEY is required to encrypt evidence.",
    });
  }
  if (/^[0-9a-fA-F]{64}$/.test(keyMaterial)) {
    return Buffer.from(keyMaterial, "hex");
  }
  return createHash("sha256").update(keyMaterial, "utf8").digest();
}

export function evidenceKeyId(keyMaterial: string): `0x${string}` {
  return keccak256(toUtf8Bytes(keyMaterial)) as `0x${string}`;
}

/** AES-256-CTR. Layout: iv (16) || ciphertext. Key is never included. */
export function encryptEvidence(plain: Uint8Array, keyMaterial: string): Uint8Array {
  const key = evidenceKeyBytes(keyMaterial);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-ctr", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([iv, enc]);
}

export function decryptEvidence(packed: Uint8Array, keyMaterial: string): Uint8Array {
  if (packed.byteLength < IV_LEN + 1) {
    throw new AppError("STORAGE_FAILED", { message: "Encrypted evidence is truncated." });
  }
  const buf = Buffer.from(packed);
  const iv = buf.subarray(0, IV_LEN);
  const enc = buf.subarray(IV_LEN);
  const decipher = createDecipheriv("aes-256-ctr", evidenceKeyBytes(keyMaterial), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
