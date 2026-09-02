import { getAddress } from "ethers";
import { ZEROG_USDCE_CCIP, ZEROG_W0G } from "@beacon/shared";

function addr(value: string): string {
  return getAddress(value.toLowerCase());
}

/** Zia mainnet token table. Source: https://docs.zia.finance/0g-mainnet/mainnet-tokens (2026-09-02). */
export type ZiaToken = {
  symbol: string;
  name: string;
  address: string;
  native?: boolean;
  docsDecimals?: number;
};

export const ZIA_W0G: ZiaToken = {
  symbol: "W0G",
  name: "Wrapped 0G",
  address: addr(ZEROG_W0G),
  docsDecimals: 18,
};

export const ZIA_NATIVE_0G: ZiaToken = {
  symbol: "0G",
  name: "Native 0G",
  address: addr(ZEROG_W0G),
  native: true,
  docsDecimals: 18,
};

export const ZIA_DOC_TOKENS: ZiaToken[] = [
  ZIA_NATIVE_0G,
  ZIA_W0G,
  { symbol: "USDT", name: "USDT (Tether)", address: addr("0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189"), docsDecimals: 6 },
  {
    symbol: "USDC",
    name: "USDC (USD Coin)",
    address: addr(ZEROG_USDCE_CCIP),
    docsDecimals: 6,
  },
  {
    symbol: "USDC.e",
    name: "USDC (USD Coin)",
    address: addr(ZEROG_USDCE_CCIP),
    docsDecimals: 6,
  },
  {
    symbol: "wstETH",
    name: "Wrapped stETH",
    address: addr("0x161a128567BF0C005b58211757F7e46eed983F02"),
    docsDecimals: 18,
  },
  {
    symbol: "ST0G",
    name: "Staked 0G",
    address: addr("0x7bBC63D01CA42491c3E084C941c3E86e55951404"),
    docsDecimals: 18,
  },
  {
    symbol: "CBBTC",
    name: "Coinbase Wrapped Bitcoin",
    address: addr("0xa5613ac7f1e83a68719b1398c8f6aaa25581db82"),
    docsDecimals: 8,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: addr("0x0555e30da8f98308edb960aa94c0db47230d2b9c"),
    docsDecimals: 8,
  },
  {
    symbol: "SOL",
    name: "Solana",
    address: addr("0x2b269f9deb4804c5a4bd97e4d951c775beaa0cc5"),
    docsDecimals: 9,
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    address: addr("0x76159c2b43ff6f630193e37ec68452169914c1bb"),
    docsDecimals: 18,
  },
];

export const ZIA_FEE_TIERS = [3000, 10000, 500] as const;

export function resolveZiaToken(input: string): ZiaToken | null {
  const raw = input.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  const bySymbol = ZIA_DOC_TOKENS.find((t) => t.symbol.toUpperCase() === upper);
  if (bySymbol) return bySymbol;
  try {
    const address = addr(raw);
    return (
      ZIA_DOC_TOKENS.find((t) => !t.native && t.address.toLowerCase() === address.toLowerCase()) ??
      ZIA_DOC_TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase()) ??
      null
    );
  } catch {
    return null;
  }
}

export function uniqueZiaAssets(): ZiaToken[] {
  const seen = new Set<string>();
  const out: ZiaToken[] = [];
  for (const token of ZIA_DOC_TOKENS) {
    const key = token.native ? "native:0G" : token.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}
