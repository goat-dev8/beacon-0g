import { hashMessage, recoverAddress } from "ethers";

export function recoverTeeSigner(message: string, signature: string): string {
  const digest = hashMessage(message);
  return recoverAddress(digest, signature);
}

export function verifyEip191(message: string, signature: string, teeSignerAddress: string): boolean {
  try {
    const recovered = recoverTeeSigner(message, signature);
    return recovered.toLowerCase() === teeSignerAddress.toLowerCase();
  } catch {
    return false;
  }
}
