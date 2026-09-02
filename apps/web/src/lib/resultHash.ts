import { sha256, toBytes, type Hex } from "viem";

/** SHA-256 of the UTF-8 result bytes shown in this browser. Not the Storage merkle root. */
export function resultSha256(text: string): Hex {
  return sha256(toBytes(text));
}

export function compareResultHash(
  local: string | null | undefined,
  published: string | null | undefined,
): { match: boolean | null; note: string } {
  if (!local) {
    return { match: null, note: "No result text in this response to hash." };
  }
  if (!published) {
    return { match: null, note: "API did not publish a result SHA-256." };
  }
  if (local.toLowerCase() === published.toLowerCase()) {
    return {
      match: true,
      note: "Browser SHA-256 of the displayed result matches the API fingerprint. Storage root is a separate merkle of encrypted evidence.",
    };
  }
  return {
    match: false,
    note: "Displayed result SHA-256 does not match the API fingerprint. Do not treat this page as a pass.",
  };
}
