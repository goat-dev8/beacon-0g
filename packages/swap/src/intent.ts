import { parseUnits } from "ethers";
import { resolveZiaToken, type ZiaToken } from "./tokens.js";

export type SwapIntent = {
  amount: string;
  tokenIn: ZiaToken;
  tokenOut: ZiaToken;
};

const PAIR =
  /\b(?:swap|convert)\s+([\d.]+)\s+([0-9a-zA-Z.]+)\s+(?:to|for|->|→)\s+([0-9a-zA-Z.]+)\b/i;

export function parseSwapIntent(text: string): SwapIntent | null {
  const match = text.match(PAIR);
  if (!match) return null;
  const tokenIn = resolveZiaToken(match[2]);
  const tokenOut = resolveZiaToken(match[3]);
  if (!tokenIn || !tokenOut) return null;
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase() && Boolean(tokenIn.native) === Boolean(tokenOut.native)) {
    return null;
  }
  return { amount: match[1], tokenIn, tokenOut };
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}

export function formatTokenAmount(amount: bigint, decimals: number, maxFrac = 8): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracStr.length > maxFrac) fracStr = fracStr.slice(0, maxFrac).replace(/0+$/, "");
  const body = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}
