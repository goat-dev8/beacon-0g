import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  getAddress,
  id,
  type Provider,
} from "ethers";
import {
  AppError,
  EXACT_INPUT_SINGLE_SELECTOR,
  ZEROG_USDCE_CCIP,
  ZEROG_W0G,
  ZIA_DEFAULT_FEE,
  ZIA_QUOTER,
  ZIA_ROUTER,
  applyBps,
  loadEnv,
  type BeaconEnv,
} from "@beacon/shared";
import { w0gUsdcePath, encodeV3Path } from "./path.js";
import { resolveZiaToken, ZIA_FEE_TIERS } from "./tokens.js";

const THIN_LIQUIDITY =
  "Beacon refused this swap because verified liquidity is insufficient.";

const QUOTE_EXACT_INPUT_SELECTOR = id("quoteExactInput(bytes,uint256)").slice(0, 10);

const SWAP_IFACE = new Interface([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

const W0G_IFACE = new Interface([
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const VAULT_EXECUTE = new Interface([
  "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce, uint256 value)",
]);

export type EthCall = (tx: { to: string; data: string }) => Promise<string>;

export type ZiaQuote = {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  path: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  impactBps: number;
  quoter: string;
  router: string;
  wrapNative: boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  executableFromSafe: boolean;
  executeBlock: string | null;
};

export type VaultCall = {
  target: string;
  data: `0x${string}`;
  value: bigint;
  maxSpend: bigint;
  selector: `0x${string}`;
};

export type BuiltSwapTx = {
  quote: ZiaQuote;
  calls: VaultCall[];
  executeCalls: Array<{
    target: string;
    data: `0x${string}`;
    maxSpend: bigint;
    value: bigint;
  }>;
};

function resolveUsdce(env: BeaconEnv): string {
  const raw = env.ZEROG_USDCE?.trim();
  if (!raw) {
    throw new AppError("VALIDATION", {
      message:
        "ZEROG_USDCE is required at swap time (Zia token list / CCIP Bridged USDC). Set env ZEROG_USDCE.",
    });
  }
  return getAddress(raw.toLowerCase());
}

function resolveOutToken(env: BeaconEnv, tokenOut?: string): string {
  if (!tokenOut) return resolveUsdce(env);
  const named = resolveZiaToken(tokenOut);
  if (named) return getAddress(named.address);
  return getAddress(tokenOut.toLowerCase());
}

function decodeAmountOut(raw: string): bigint {
  if (!raw || raw === "0x") return 0n;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length < 64) return 0n;
  return BigInt("0x" + hex.slice(0, 64));
}

async function quotePath(
  call: EthCall,
  quoter: string,
  path: `0x${string}`,
  amountIn: bigint,
): Promise<bigint> {
  const encoded = AbiCoder.defaultAbiCoder().encode(["bytes", "uint256"], [path, amountIn]);
  const data = (QUOTE_EXACT_INPUT_SELECTOR + encoded.slice(2)) as string;
  const raw = await call({ to: quoter, data });
  return decodeAmountOut(raw);
}

function ethCallFromProvider(provider: Provider): EthCall {
  return async (tx) => provider.call({ to: tx.to, data: tx.data });
}

export async function quoteExactIn(
  amountIn0gWei: bigint,
  opts: {
    env?: BeaconEnv;
    tokenOut?: string;
    provider?: Provider;
    call?: EthCall;
    slippageBps?: number;
    probeWei?: bigint;
  } = {},
): Promise<ZiaQuote> {
  const env = opts.env ?? loadEnv();
  if (!env.ENABLE_SWAP) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
  }
  if (amountIn0gWei <= 0n) {
    throw new AppError("VALIDATION", { message: "amountIn must be > 0." });
  }

  const w0g = getAddress((env.ZEROG_W0G || ZEROG_W0G).toLowerCase());
  const usdce = resolveOutToken(env, opts.tokenOut);
  const quoter = getAddress(env.ZIA_QUOTER || ZIA_QUOTER);
  const router = getAddress(env.ZIA_ROUTER || ZIA_ROUTER);
  const fee = ZIA_DEFAULT_FEE;
  const path = w0gUsdcePath(w0g, usdce, fee);
  const slippageBps = opts.slippageBps ?? 50;
  const call =
    opts.call ??
    ethCallFromProvider(opts.provider ?? new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID));

  let amountOut: bigint;
  try {
    amountOut = await quotePath(call, quoter, path, amountIn0gWei);
  } catch (cause) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY, cause });
  }

  if (amountOut === 0n) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
  }

  const probeWei = opts.probeWei ?? (amountIn0gWei > 10n ** 15n ? 10n ** 15n : amountIn0gWei / 10n || 1n);
  let impactBps = 0;
  if (probeWei > 0n && probeWei < amountIn0gWei) {
    const probeOut = await quotePath(call, quoter, path, probeWei);
    if (probeOut === 0n) {
      throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
    }
    const expected = (probeOut * amountIn0gWei) / probeWei;
    if (expected > amountOut) {
      impactBps = Number(((expected - amountOut) * 10_000n) / expected);
    }
  }

  if (impactBps > env.MAX_IMPACT_BPS) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY, details: { impactBps } });
  }

  const minOut = amountOut - applyBps(amountOut, slippageBps);
  if (minOut <= 0n) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
  }

  return {
    tokenIn: w0g,
    tokenOut: usdce,
    fee,
    path,
    amountIn: amountIn0gWei,
    amountOut,
    minOut,
    impactBps,
    quoter,
    router,
    wrapNative: true,
    tokenInSymbol: "0G",
    tokenOutSymbol: resolveZiaToken(usdce)?.symbol ?? "USDC",
    executableFromSafe: true,
    executeBlock: null,
  };
}

export async function quoteZiaPair(opts: {
  amountIn: bigint;
  tokenIn: string;
  tokenOut: string;
  env?: BeaconEnv;
  provider?: Provider;
  call?: EthCall;
  slippageBps?: number;
  probeWei?: bigint;
}): Promise<ZiaQuote> {
  const env = opts.env ?? loadEnv();
  if (!env.ENABLE_SWAP) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
  }
  if (opts.amountIn <= 0n) {
    throw new AppError("VALIDATION", { message: "amountIn must be > 0." });
  }
  const tokenIn = resolveZiaToken(opts.tokenIn);
  const tokenOut = resolveZiaToken(opts.tokenOut);
  if (!tokenIn || !tokenOut) {
    throw new AppError("SWAP_REFUSED", {
      message: "Beacon cannot verify a viable Zia route for this pair.",
    });
  }
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    throw new AppError("SWAP_REFUSED", {
      message: "Beacon cannot verify a viable Zia route for this pair.",
    });
  }

  const quoter = getAddress((env.ZIA_QUOTER || ZIA_QUOTER).toLowerCase());
  const router = getAddress((env.ZIA_ROUTER || ZIA_ROUTER).toLowerCase());
  const call =
    opts.call ??
    ethCallFromProvider(opts.provider ?? new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID));
  const slippageBps = opts.slippageBps ?? 50;

  let fee = ZIA_DEFAULT_FEE;
  let path = encodeV3Path(tokenIn.address, fee, tokenOut.address);
  let amountOut = 0n;
  for (const candidate of ZIA_FEE_TIERS) {
    const candidatePath = encodeV3Path(tokenIn.address, candidate, tokenOut.address);
    try {
      const out = await quotePath(call, quoter, candidatePath, opts.amountIn);
      if (out > 0n) {
        fee = candidate;
        path = candidatePath;
        amountOut = out;
        break;
      }
    } catch {
      /* try next fee tier */
    }
  }
  if (amountOut === 0n) {
    throw new AppError("SWAP_REFUSED", {
      message: "Beacon cannot verify a viable Zia route for this pair.",
    });
  }

  const probeWei = opts.probeWei ?? (opts.amountIn > 10n ? opts.amountIn / 10n : 0n);
  let impactBps = 0;
  if (probeWei > 0n && probeWei < opts.amountIn) {
    const probeOut = await quotePath(call, quoter, path, probeWei);
    if (probeOut === 0n) {
      throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
    }
    const expected = (probeOut * opts.amountIn) / probeWei;
    if (expected > amountOut) {
      impactBps = Number(((expected - amountOut) * 10_000n) / expected);
    }
  }
  if (impactBps > env.MAX_IMPACT_BPS) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY, details: { impactBps } });
  }
  const minOut = amountOut - applyBps(amountOut, slippageBps);
  if (minOut <= 0n) {
    throw new AppError("SWAP_REFUSED", { message: THIN_LIQUIDITY });
  }

  const wrapNative = Boolean(tokenIn.native);
  const executableFromSafe = wrapNative || tokenIn.symbol === "W0G";
  return {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    fee,
    path,
    amountIn: opts.amountIn,
    amountOut,
    minOut,
    impactBps,
    quoter,
    router,
    wrapNative,
    tokenInSymbol: tokenIn.symbol,
    tokenOutSymbol: tokenOut.native ? "0G" : tokenOut.symbol,
    executableFromSafe,
    executeBlock: executableFromSafe
      ? null
      : "Beacon Safe wealth() is native 0G + W0G. A swap that credits W0G reverts (unexpected credit). Quote is live; Safe execution is refused.",
  };
}

export function exactInputSingleSelector(): `0x${string}` {
  const sel = SWAP_IFACE.getFunction("exactInputSingle")!.selector as `0x${string}`;
  if (sel.toLowerCase() !== EXACT_INPUT_SINGLE_SELECTOR) {
    throw new Error(`exactInputSingle selector mismatch: ${sel}`);
  }
  return sel;
}

export function encodeExactInputSingle(opts: {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): `0x${string}` {
  exactInputSingleSelector();
  return SWAP_IFACE.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: getAddress(opts.tokenIn),
      tokenOut: getAddress(opts.tokenOut),
      fee: opts.fee,
      recipient: getAddress(opts.recipient),
      deadline: opts.deadline,
      amountIn: opts.amountIn,
      amountOutMinimum: opts.amountOutMinimum,
      sqrtPriceLimitX96: 0,
    },
  ]) as `0x${string}`;
}

export function encodeVaultExecute(call: {
  target: string;
  data: `0x${string}`;
  maxSpend: bigint;
  nonce: bigint;
  value: bigint;
}): `0x${string}` {
  return VAULT_EXECUTE.encodeFunctionData("execute", [
    getAddress(call.target),
    call.data,
    call.maxSpend,
    call.nonce,
    call.value,
  ]) as `0x${string}`;
}

/** Path A: optional W0G.deposit{value} + approve + exactInputSingle. Recipient = vault. */
export function buildSwapTx(
  quote: ZiaQuote,
  vault: string,
  opts: { nonce?: bigint; deadlineSeconds?: number; wrapNative?: boolean } = {},
): BuiltSwapTx {
  const recipient = getAddress(vault);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSeconds ?? 1200));
  const wrapNative = opts.wrapNative ?? quote.wrapNative ?? true;
  const approveData = W0G_IFACE.encodeFunctionData("approve", [quote.router, quote.amountIn]) as `0x${string}`;
  const swapData = encodeExactInputSingle({
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    fee: quote.fee,
    recipient,
    deadline,
    amountIn: quote.amountIn,
    amountOutMinimum: quote.minOut,
  });

  const calls: VaultCall[] = [];
  if (wrapNative) {
    const depositData = W0G_IFACE.encodeFunctionData("deposit") as `0x${string}`;
    calls.push({
      target: quote.tokenIn,
      data: depositData,
      value: quote.amountIn,
      maxSpend: 0n,
      selector: depositData.slice(0, 10) as `0x${string}`,
    });
  }
  calls.push(
    {
      target: quote.tokenIn,
      data: approveData,
      value: 0n,
      maxSpend: 0n,
      selector: approveData.slice(0, 10) as `0x${string}`,
    },
    {
      target: quote.router,
      data: swapData,
      value: 0n,
      maxSpend: quote.executableFromSafe ? quote.amountIn : 0n,
      selector: EXACT_INPUT_SINGLE_SELECTOR,
    },
  );

  return {
    quote,
    calls,
    executeCalls: calls.map((c) => ({
      target: c.target,
      data: c.data,
      maxSpend: c.maxSpend,
      value: c.value,
    })),
  };
}

export { ZEROG_USDCE_CCIP, THIN_LIQUIDITY };
