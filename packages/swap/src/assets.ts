import { Interface, JsonRpcProvider, getAddress, type Provider } from "ethers";
import { loadEnv, ZIA_FACTORY, ZIA_QUOTER, type BeaconEnv } from "@beacon/shared";
import { encodeV3Path } from "./path.js";
import { ZIA_FEE_TIERS, ZIA_W0G, uniqueZiaAssets, type ZiaToken } from "./tokens.js";
import type { EthCall } from "./zia.js";

const FACTORY = new Interface([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const ERC20 = new Interface(["function decimals() view returns (uint8)"]);
const QUOTER = new Interface([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";

export type ZiaPoolHit = {
  from: ZiaToken;
  to: ZiaToken;
  fee: number;
  pool: string;
  quoted: boolean;
  amountOut?: string;
};

function ethCallFromProvider(provider: Provider): EthCall {
  return async (tx) => provider.call({ to: tx.to, data: tx.data });
}

async function getPool(
  call: EthCall,
  factory: string,
  tokenA: string,
  tokenB: string,
  fee: number,
): Promise<string | null> {
  const data = FACTORY.encodeFunctionData("getPool", [getAddress(tokenA), getAddress(tokenB), fee]);
  const raw = await call({ to: factory, data });
  const [pool] = FACTORY.decodeFunctionResult("getPool", raw);
  if (!pool || String(pool).toLowerCase() === ZERO) return null;
  return getAddress(pool);
}

export async function findPoolFee(
  call: EthCall,
  factory: string,
  tokenA: string,
  tokenB: string,
): Promise<{ fee: number; pool: string } | null> {
  for (const fee of ZIA_FEE_TIERS) {
    const pool = await getPool(call, factory, tokenA, tokenB, fee);
    if (pool) return { fee, pool };
  }
  return null;
}

let cache: { at: number; routes: ZiaPoolHit[] } | null = null;

export async function listSwapAssets(
  opts: { env?: BeaconEnv; call?: EthCall; now?: number } = {},
): Promise<{ tokens: ZiaToken[]; routes: ZiaPoolHit[]; asOf: string; source: string }> {
  const env = opts.env ?? loadEnv();
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < 30_000 && !opts.call) {
    return {
      tokens: uniqueZiaAssets(),
      routes: cache.routes,
      asOf: new Date(cache.at).toISOString(),
      source: "https://docs.zia.finance/0g-mainnet/mainnet-tokens + Zia factory getPool",
    };
  }

  const factory = getAddress((env.ZIA_FACTORY || ZIA_FACTORY).toLowerCase());
  const quoter = getAddress((env.ZIA_QUOTER || ZIA_QUOTER).toLowerCase());
  const call =
    opts.call ??
    ethCallFromProvider(new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID));
  const w0g = ZIA_W0G;
  const tokens = uniqueZiaAssets().filter((t) => !t.native);
  const routes: ZiaPoolHit[] = [];

  for (const token of tokens) {
    if (token.address.toLowerCase() === w0g.address.toLowerCase()) continue;
    const hit = await findPoolFee(call, factory, w0g.address, token.address);
    if (!hit) continue;
    const path = encodeV3Path(w0g.address, hit.fee, token.address);
    const amountIn = 10n ** 16n;
    let quoted = false;
    let amountOut: string | undefined;
    try {
      const data = QUOTER.encodeFunctionData("quoteExactInput", [path, amountIn]);
      const raw = await call({ to: quoter, data });
      const hex = (raw.startsWith("0x") ? raw.slice(2) : raw);
      const out = hex.length >= 64 ? BigInt("0x" + hex.slice(0, 64)) : 0n;
      quoted = out > 0n;
      amountOut = out.toString();
    } catch {
      quoted = false;
    }
    if (!quoted) continue;
    routes.push({
      from: { ...w0g, symbol: "0G", native: true },
      to: token,
      fee: hit.fee,
      pool: hit.pool,
      quoted,
      amountOut,
    });
    routes.push({
      from: token,
      to: { ...w0g, symbol: "0G", native: true },
      fee: hit.fee,
      pool: hit.pool,
      quoted,
    });
  }

  cache = { at: now, routes };
  return {
    tokens: uniqueZiaAssets(),
    routes,
    asOf: new Date(now).toISOString(),
    source: "https://docs.zia.finance/0g-mainnet/mainnet-tokens + Zia factory getPool",
  };
}

export async function readDecimals(call: EthCall, token: string, fallback: number): Promise<number> {
  try {
    const raw = await call({ to: getAddress(token), data: ERC20.encodeFunctionData("decimals") });
    const [d] = ERC20.decodeFunctionResult("decimals", raw);
    const n = Number(d);
    return Number.isFinite(n) && n > 0 && n <= 36 ? n : fallback;
  } catch {
    return fallback;
  }
}
