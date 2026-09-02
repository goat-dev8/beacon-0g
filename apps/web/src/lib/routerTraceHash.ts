import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";

/** Same encoding as the API: keccak256(abi.encode(keccak256(utf8 requestId), provider, teeVerified)). */
export function recomputeRouterTraceClaim(trace: {
  requestId: string;
  provider: `0x${string}`;
  teeVerified: boolean;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bool" }],
      [keccak256(toHex(trace.requestId)), trace.provider, trace.teeVerified],
    ),
  );
}
