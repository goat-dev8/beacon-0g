import { Interface, JsonRpcProvider, getAddress, type Provider } from "ethers";
import { loadEnv, ZIA_FACTORY, ZIA_QUOTER, type BeaconEnv } from "@beacon/shared";
import { encodeV3Path } from "./path.js";
import { ZIA_FEE_TIERS, ZIA_W0G, uniqueZiaAssets, type ZiaToken } from "./tokens.js";
import { formatTokenAmount } from "./intent.js";
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
  amountIn?: string;
  amountInDisplay?: string;
  estimatedOutDisplay?: string;
  executableFromSafe?: boolean;
  quotedAt?: string;
};

function ethCallFromProvider(provider: Provider): EthCall {
  return async (tx) => provider.call({ to: tx.to, data: tx.data });
}

function decodeAmountOut(raw: string): bigint {
  const hex = (raw.startsWith("0x") ? raw.slice(2) : raw);
  return hex.length >= 64 ? BigInt("0x" + hex.slice(0, 64)) : 0n;
}

async function quoteExactInput(
  call: EthCall,
  quoter: string,
  tokenIn: string,
  fee: number,
  tokenOut: string,
  amountIn: bigint,
): Promise<bigint | null> {
  if (amountIn <= 0n) return null;
  const path = encodeV3Path(tokenIn, fee, tokenOut);
  try {
    const data = QUOTER.encodeFunctionData("quoteExactInput", [path, amountIn]);
    const raw = await call({ to: quoter, data });
    const out = decodeAmountOut(typeof raw === "string" ? raw : String(raw));
    return out > 0n ? out : null;
  } catch {
    return null;
  }
}
function decodePoolAddress(raw: string): string | null {
  const hex = (raw?.startsWith("0x") ? raw.slice(2) : raw || "").padStart(64, "0");
  if (!/^[0-9a-fA-F]{64}$/.test(hex.slice(-64))) return null;
  const addr = `0x${hex.slice(-40)}`;
  if (addr.toLowerCase() === ZERO) return null;
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

export async function getPoolAtFee(
  call: EthCall,
  factory: string,
  tokenA: string,
  tokenB: string,
  fee: number,
): Promise<string | null> {
  const factoryAddr = getAddress(factory.toLowerCase());
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  for (const [token0, token1] of [
    [a, b],
    [b, a],
  ] as const) {
    const data = FACTORY.encodeFunctionData("getPool", [token0, token1, fee]);
    try {
      const raw = await call({ to: factoryAddr, data });
      const pool = decodePoolAddress(typeof raw === "string" ? raw : String(raw));
      if (pool) return pool;
    } catch {
      /* try the swapped token order */
    }
  }
  return null;
}

export async function findPoolFee(
  call: EthCall,
  factory: string,
  tokenA: string,
  tokenB: string,
): Promise<{ fee: number; pool: string } | null> {
  for (const fee of ZIA_FEE_TIERS) {
    const pool = await getPoolAtFee(call, factory, tokenA, tokenB, fee);
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

  const quotedAt = new Date(now).toISOString();
  for (const token of tokens) {
    if (token.address.toLowerCase() === w0g.address.toLowerCase()) continue;
    const hit = await findPoolFee(call, factory, w0g.address, token.address);
    if (!hit) continue;
    const amountIn = 10n ** 16n;
    const out = await quoteExactInput(call, quoter, w0g.address, hit.fee, token.address, amountIn);
    if (out == null) continue;
    const outDecimals = token.docsDecimals ?? 18;
    routes.push({
      from: { ...w0g, symbol: "0G", native: true },
      to: token,
      fee: hit.fee,
      pool: hit.pool,
      quoted: true,
      amountIn: amountIn.toString(),
      amountOut: out.toString(),
      amountInDisplay: "0.01 0G",
      estimatedOutDisplay: `${formatTokenAmount(out, outDecimals)} ${token.symbol}`,
      executableFromSafe: true,
      quotedAt,
    });
    const dec = token.docsDecimals ?? 18;
    const reverseIn = 10n ** BigInt(Math.max(0, dec - 3));
    const reverseOut = await quoteExactInput(call, quoter, token.address, hit.fee, w0g.address, reverseIn);
    if (reverseOut == null) continue;
    routes.push({
      from: token,
      to: { ...w0g, symbol: "0G", native: true },
      fee: hit.fee,
      pool: hit.pool,
      quoted: true,
      amountIn: reverseIn.toString(),
      amountOut: reverseOut.toString(),
      amountInDisplay: `0.001 ${token.symbol}`,
      estimatedOutDisplay: `${formatTokenAmount(reverseOut, 18)} 0G`,
      executableFromSafe: false,
      quotedAt,
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
