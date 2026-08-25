import { getAddress, solidityPacked } from "ethers";
import { ZIA_DEFAULT_FEE } from "@beacon/shared";

/** Uniswap V3 path: tokenIn (20) || fee uint24 BE (3) || tokenOut (20). */
export function encodeV3Path(tokenIn: string, fee: number, tokenOut: string): `0x${string}` {
  return solidityPacked(
    ["address", "uint24", "address"],
    [getAddress(tokenIn), fee, getAddress(tokenOut)],
  ) as `0x${string}`;
}

export function w0gUsdcePath(w0g: string, usdce: string, fee = ZIA_DEFAULT_FEE): `0x${string}` {
  return encodeV3Path(w0g, fee, usdce);
}
