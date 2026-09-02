import { AppError } from "@beacon/shared";

const LIFI = "https://li.quest/v1";

/** Official LI.FI chain key zerog / 16661. */
export const LIFI_ZEROG_CHAIN = 16661;

const NATIVE_0G = "0x0000000000000000000000000000000000000000";
const W0G = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
/** LI.FI "Bridged USDC" on Aristotle (CCIP/Stargate path used for Base inbound). */
export const ZEROG_USDCE = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export type ChainMeta = { chainId: number; name: string; key: string };

export const CHAINS: Record<string, ChainMeta> = {
  "0g": { chainId: 16661, name: "0G Aristotle", key: "0g" },
  aristotle: { chainId: 16661, name: "0G Aristotle", key: "0g" },
  base: { chainId: 8453, name: "Base", key: "base" },
  ethereum: { chainId: 1, name: "Ethereum", key: "ethereum" },
  eth: { chainId: 1, name: "Ethereum", key: "ethereum" },
};

export type ParsedBridgeIntent = {
  sourceChainId: number;
  destChainId: number;
  sourceName: string;
  destName: string;
  fromToken: string;
  toToken: string;
  fromSymbol: string;
  toSymbol: string;
  fromDecimals: number;
  toDecimals: number;
  amountAtomic: string;
  amountDisplay: string;
  executionMode: "WALLET_EXECUTABLE";
  supported: boolean;
  unsupportedReason?: string;
};

function chainForKey(raw: string | undefined): ChainMeta | null {
  if (!raw) return null;
  return CHAINS[raw.toLowerCase()] ?? null;
}

function toAtomic(display: string, decimals: number): string {
  const [whole, frac = ""] = display.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")).toString();
}

function formatAmount(raw: string, decimals: number): string {
  try {
    const n = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole.toString()}.${frac}` : whole.toString();
  } catch {
    return raw;
  }
}

function usdcOn(chainId: number): { token: string; symbol: string; decimals: number } | null {
  if (chainId === 8453) return { token: BASE_USDC, symbol: "USDC", decimals: 6 };
  if (chainId === 1) return { token: ETH_USDC, symbol: "USDC", decimals: 6 };
  if (chainId === 16661) return { token: ZEROG_USDCE, symbol: "USDC.e", decimals: 6 };
  return null;
}

function namedChain(lower: string, kind: "from" | "to" | "on"): ChainMeta | null {
  const re =
    kind === "from"
      ? /\bfrom\s+(0g|aristotle|base|ethereum|eth)\b/
      : kind === "to"
        ? /\bto\s+(0g|aristotle|base|ethereum|eth)\b/
        : /\bon\s+(0g|aristotle|base|ethereum|eth)\b/;
  const m = lower.match(re);
  return chainForKey(m?.[1]);
}

function anyForeignChain(lower: string): ChainMeta | null {
  if (/\bbase\b/.test(lower)) return CHAINS.base;
  if (/\bethereum\b|\beth\b/.test(lower)) return CHAINS.ethereum;
  return null;
}

function unsupported(
  partial: Partial<ParsedBridgeIntent> & Pick<ParsedBridgeIntent, "amountDisplay" | "amountAtomic">,
  reason: string,
): ParsedBridgeIntent {
  return {
    sourceChainId: partial.sourceChainId ?? 0,
    destChainId: partial.destChainId ?? 0,
    sourceName: partial.sourceName ?? "unknown",
    destName: partial.destName ?? "unknown",
    fromToken: partial.fromToken ?? NATIVE_0G,
    toToken: partial.toToken ?? NATIVE_0G,
    fromSymbol: partial.fromSymbol ?? "?",
    toSymbol: partial.toSymbol ?? "?",
    fromDecimals: partial.fromDecimals ?? 18,
    toDecimals: partial.toDecimals ?? 6,
    amountAtomic: partial.amountAtomic,
    amountDisplay: partial.amountDisplay,
    executionMode: "WALLET_EXECUTABLE",
    supported: false,
    unsupportedReason: reason,
  };
}

/**
 * Directional parser. Native 0G / W0G as the input asset always sources from Aristotle.
 * Never infers Base → 0G merely because the word "Base" appears.
 */
export function parseBridgeIntent(text: string): ParsedBridgeIntent | null {
  const lower = text.toLowerCase();
  if (!/\bbridge\b/.test(lower)) return null;

  if (/\bsolana\b|\bavalanche\b|\bpolygon\b|\barbitrum\b|\boptimism\b|\bbnb\b|\bbsc\b/.test(lower)) {
    const amt = lower.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "0";
    return unsupported(
      { amountDisplay: amt, amountAtomic: "0" },
      "That route is not currently supported. Beacon quotes Base↔0G and Ethereum→0G on LI.FI. It will not substitute a different direction.",
    );
  }

  const amtW0g = lower.match(/(\d+(?:\.\d+)?)\s*w0g\b/);
  const amt0g = !amtW0g ? lower.match(/(\d+(?:\.\d+)?)\s*(?:native\s+)?0g\b/) : null;
  const amtUsdc = lower.match(/(\d+(?:\.\d+)?)\s*usdc(?:\.e)?/);

  if (!amtW0g && !amt0g && !amtUsdc) return null;

  const fromNamed = namedChain(lower, "from");
  const toNamed = namedChain(lower, "to");
  const onNamed = namedChain(lower, "on");
  const foreign = anyForeignChain(lower);

  if (amt0g || amtW0g) {
    const amountDisplay = (amtW0g ?? amt0g)![1];
    const fromDecimals = 18;
    const amountAtomic = toAtomic(amountDisplay, fromDecimals);
    if (BigInt(amountAtomic) <= 0n) return null;
    const source = CHAINS["0g"];
    const dest = toNamed && toNamed.chainId !== 16661 ? toNamed : onNamed && onNamed.chainId !== 16661 ? onNamed : fromNamed && fromNamed.chainId !== 16661 ? fromNamed : foreign && foreign.chainId !== 16661 ? foreign : null;
    if (!dest) {
      return unsupported(
        {
          sourceChainId: source.chainId,
          sourceName: source.name,
          fromSymbol: amtW0g ? "W0G" : "0G",
          fromToken: amtW0g ? W0G : NATIVE_0G,
          fromDecimals,
          amountDisplay,
          amountAtomic,
        },
        "Name a destination chain. Example: Bridge 0.3 0G to USDC on Base.",
      );
    }
    if (dest.chainId === 16661) {
      return unsupported(
        {
          sourceChainId: source.chainId,
          destChainId: dest.chainId,
          sourceName: source.name,
          destName: dest.name,
          fromSymbol: amtW0g ? "W0G" : "0G",
          amountDisplay,
          amountAtomic,
        },
        "Native 0G is already on Aristotle. That is not a bridge.",
      );
    }
    const destToken = usdcOn(dest.chainId);
    if (!destToken) {
      return unsupported(
        {
          sourceChainId: source.chainId,
          destChainId: dest.chainId,
          sourceName: source.name,
          destName: dest.name,
          amountDisplay,
          amountAtomic,
        },
        `That route is not currently supported: ${source.name} → ${dest.name}.`,
      );
    }
    const liveQuoted = dest.chainId === 8453 && !amtW0g;
    return {
      sourceChainId: source.chainId,
      destChainId: dest.chainId,
      sourceName: source.name,
      destName: dest.name,
      fromToken: amtW0g ? W0G : NATIVE_0G,
      toToken: destToken.token,
      fromSymbol: amtW0g ? "W0G" : "0G",
      toSymbol: destToken.symbol,
      fromDecimals,
      toDecimals: destToken.decimals,
      amountAtomic,
      amountDisplay,
      executionMode: "WALLET_EXECUTABLE",
      supported: liveQuoted,
      unsupportedReason: liveQuoted
        ? undefined
        : `That route is not currently supported: ${amtW0g ? "W0G" : "native 0G"} → ${destToken.symbol} on ${dest.name}. Beacon will not reverse this into ${dest.name} → 0G.`,
    };
  }

  const amountDisplay = amtUsdc![1];
  const amountAtomic = toAtomic(amountDisplay, 6);
  if (BigInt(amountAtomic) <= 0n) return null;

  const source =
    fromNamed && fromNamed.chainId !== 16661
      ? fromNamed
      : toNamed && toNamed.chainId === 16661 && foreign
        ? foreign
        : fromNamed?.chainId === 16661
          ? CHAINS["0g"]
          : null;
  const dest =
    toNamed && toNamed.chainId === 16661
      ? CHAINS["0g"]
      : onNamed && onNamed.chainId === 16661
        ? CHAINS["0g"]
        : toNamed && toNamed.chainId !== 16661
          ? toNamed
          : source && source.chainId !== 16661
            ? CHAINS["0g"]
            : null;

  if (!source || !dest) {
    return unsupported(
      { amountDisplay, amountAtomic },
      "Name a source chain and a destination. Example: Bridge 1 USDC from Base to 0G.",
    );
  }
  if (source.chainId === dest.chainId) {
    return unsupported(
      { sourceChainId: source.chainId, destChainId: dest.chainId, sourceName: source.name, destName: dest.name, amountDisplay, amountAtomic },
      "Source and destination are the same chain. That is not a bridge.",
    );
  }

  const fromMeta = usdcOn(source.chainId);
  const toMeta = usdcOn(dest.chainId);
  if (!fromMeta || !toMeta) {
    return unsupported(
      {
        sourceChainId: source.chainId,
        destChainId: dest.chainId,
        sourceName: source.name,
        destName: dest.name,
        amountDisplay,
        amountAtomic,
      },
      `That route is not currently supported: ${source.name} → ${dest.name}.`,
    );
  }

  const inbound = dest.chainId === 16661 && (source.chainId === 8453 || source.chainId === 1);
  return {
    sourceChainId: source.chainId,
    destChainId: dest.chainId,
    sourceName: source.name,
    destName: dest.name,
    fromToken: fromMeta.token,
    toToken: toMeta.token,
    fromSymbol: fromMeta.symbol,
    toSymbol: toMeta.symbol,
    fromDecimals: fromMeta.decimals,
    toDecimals: toMeta.decimals,
    amountAtomic,
    amountDisplay,
    executionMode: "WALLET_EXECUTABLE",
    supported: inbound,
    unsupportedReason: inbound
      ? undefined
      : `That route is not currently supported: ${fromMeta.symbol} on ${source.name} → ${toMeta.symbol} on ${dest.name}. Beacon will not reverse this into the opposite direction.`,
  };
}

export type LifiQuoteCard = {
  type: "bridge_quote";
  title: string;
  tool: string;
  source: string;
  destination: string;
  assetIn: string;
  assetOut: string;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  etaSeconds: number;
  feeSummary: string;
  gasSummary: string | null;
  fromChainId: number;
  toChainId: number;
  approvalAddress: string | null;
  transactionRequest: { to: string; data: string; value: string; chainId: number } | null;
  executableFromBeaconSafe: false;
  executableFromUserWallet: boolean;
  executionMode: "WALLET_EXECUTABLE" | "SAFE_EXECUTABLE" | "HYBRID";
  requiredSignatures: string[];
  requiredWallet: string;
  recipient: string;
  honesty: string;
  quoteId: string;
  fromToken: string;
  toToken: string;
  amountAtomic: string;
  quotedAt: string;
};

function feeSummary(estimate: Record<string, unknown>): string {
  const fees = Array.isArray(estimate.feeCosts) ? estimate.feeCosts : [];
  return fees
    .map((f: { name?: string; amountUSD?: string; included?: boolean }) => {
      const usd = f.amountUSD ? `$${f.amountUSD}` : "";
      return `${f.name ?? "fee"} ${usd}${f.included ? " (included)" : ""}`.trim();
    })
    .join("; ");
}

function gasSummary(estimate: Record<string, unknown>): string | null {
  const gas = Array.isArray(estimate.gasCosts) ? estimate.gasCosts : [];
  if (!gas.length) return null;
  return gas
    .map((g: { type?: string; amountUSD?: string }) => `${g.type ?? "gas"} ${g.amountUSD ? `$${g.amountUSD}` : ""}`.trim())
    .join("; ");
}

export async function quoteLifiBridge(
  intent: ParsedBridgeIntent,
  fromAddress: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LifiQuoteCard> {
  if (!intent.supported) {
    throw new AppError("UNSUPPORTED_ROUTE", {
      message: intent.unsupportedReason ?? "That route is not currently supported.",
    });
  }
  const url = new URL(`${LIFI}/quote`);
  url.searchParams.set("fromChain", String(intent.sourceChainId));
  url.searchParams.set("toChain", String(intent.destChainId));
  url.searchParams.set("fromToken", intent.fromToken);
  url.searchParams.set("toToken", intent.toToken);
  url.searchParams.set("fromAmount", intent.amountAtomic);
  url.searchParams.set("fromAddress", fromAddress);

  async function once() {
    const res = await fetchImpl(url.toString());
    const body = (await res.json()) as Record<string, unknown>;
    return { res, body };
  }
  let { res, body } = await once();
  if (!res.ok && res.status >= 500) {
    await new Promise((r) => setTimeout(r, 400));
    ({ res, body } = await once());
  }
  if (!res.ok) {
    const msg =
      typeof body.message === "string"
        ? body.message
        : `LI.FI has no executable route ${intent.sourceName} → ${intent.destName}.`;
    throw new AppError("UNSUPPORTED_ROUTE", {
      message: `${msg} Beacon will not quote the opposite direction.`,
    });
  }
  const estimate = (body.estimate as Record<string, unknown> | undefined) ?? {};
  const action = (body.action as Record<string, unknown> | undefined) ?? {};
  const fromTokObj = action.fromToken as { symbol?: string; decimals?: number } | undefined;
  const toTokObj = action.toToken as { symbol?: string; decimals?: number } | undefined;
  const fromTok = fromTokObj?.symbol ?? intent.fromSymbol;
  const toTok = toTokObj?.symbol ?? intent.toSymbol;
  const outDecimals = Number(toTokObj?.decimals ?? intent.toDecimals);
  const tx = body.transactionRequest as
    | { to?: string; data?: string; value?: string; chainId?: number }
    | undefined;
  const hasTx = Boolean(tx?.to && tx?.data);
  const toAmount = String(estimate.toAmount ?? "0");
  const toAmountMin = String(estimate.toAmountMin ?? toAmount);
  const quotedAt = new Date().toISOString();
  const requiredWallet = `Your wallet on ${intent.sourceName} (chain ${intent.sourceChainId}). Beacon Safe cannot sign this.`;
  return {
    type: "bridge_quote",
    title: `Bridge ${fromTok} on ${intent.sourceName} → ${toTok} on ${intent.destName}`,
    tool: String(body.tool ?? "lifi"),
    source: intent.sourceName,
    destination: intent.destName,
    assetIn: fromTok,
    assetOut: toTok,
    amountIn: intent.amountDisplay,
    estimatedOut: formatAmount(toAmount, outDecimals),
    minOut: formatAmount(toAmountMin, outDecimals),
    etaSeconds: Number(estimate.executionDuration ?? 0),
    feeSummary: feeSummary(estimate) || "See LI.FI quote",
    gasSummary: gasSummary(estimate),
    fromChainId: intent.sourceChainId,
    toChainId: intent.destChainId,
    approvalAddress: typeof estimate.approvalAddress === "string" ? estimate.approvalAddress : null,
    transactionRequest: hasTx
      ? {
          to: String(tx!.to),
          data: String(tx!.data),
          value: String(tx!.value ?? "0x0"),
          chainId: Number(tx!.chainId ?? intent.sourceChainId),
        }
      : null,
    executableFromBeaconSafe: false,
    executableFromUserWallet: hasTx,
    executionMode: "WALLET_EXECUTABLE",
    requiredSignatures: hasTx ? [requiredWallet] : ["No executable transactionRequest from LI.FI."],
    requiredWallet,
    recipient: fromAddress,
    honesty:
      "Live LI.FI quote. Beacon Safe lives on Aristotle and cannot sign a source-chain tx. Complete only when LI.FI reports DONE with a destination tx for this same source hash.",
    quoteId: String(body.id ?? ""),
    fromToken: intent.fromToken,
    toToken: intent.toToken,
    amountAtomic: intent.amountAtomic,
    quotedAt,
  };
}

export type LifiStatus = {
  status: string;
  sendingTx: string | null;
  receivingTx: string | null;
  complete: boolean;
  honesty: string;
};

export async function statusLifiBridge(
  txHash: string,
  fromChainId: number,
  fetchImpl: typeof fetch = fetch,
  toChainId?: number,
): Promise<LifiStatus> {
  const dest =
    toChainId && (toChainId === 1 || toChainId === 8453 || toChainId === 16661)
      ? toChainId
      : fromChainId === LIFI_ZEROG_CHAIN
        ? 8453
        : LIFI_ZEROG_CHAIN;
  const url = new URL(`${LIFI}/status`);
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", String(fromChainId));
  url.searchParams.set("toChain", String(dest));
  const res = await fetchImpl(url.toString());
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new AppError("NO_FIT", {
      message: typeof body.message === "string" ? body.message : `LI.FI status failed (${res.status}).`,
    });
  }
  const status = String(body.status ?? "UNKNOWN");
  const sending = (body.sending as { txHash?: string } | undefined)?.txHash ?? txHash;
  const receiving = (body.receiving as { txHash?: string } | undefined)?.txHash ?? null;
  const sameSource = sending.toLowerCase() === txHash.toLowerCase();
  const failed = /FAIL|CANCEL|INVALID|NOT_FOUND/i.test(status);
  const complete = status === "DONE" && Boolean(receiving) && sameSource && !failed;
  return {
    status: sameSource ? status : "NOT_FOUND",
    sendingTx: sending,
    receivingTx: sameSource ? receiving : null,
    complete,
    honesty: complete
      ? "LI.FI status DONE with a destination transaction for this source hash."
      : !sameSource
        ? "LI.FI did not confirm this source hash. Destination is not complete."
        : failed
          ? `LI.FI status is ${status}. Destination is not complete.`
          : `LI.FI status is ${status}. Beacon will not mark the bridge complete until destination is detected for this source hash.`,
  };
}

/** Complete only when status is DONE and a destination tx exists. Never infer from source. */
export function destinationComplete(st: { complete?: boolean; receivingTx?: string | null }): boolean {
  return st.complete === true && Boolean(st.receivingTx);
}

export function extractBridgeTxHash(args: { txHash?: unknown; text?: unknown }): string | null {
  const direct = String(args.txHash ?? "");
  if (/^0x[a-fA-F0-9]{64}$/.test(direct)) return direct;
  const text = String(args.text ?? "");
  const m = text.match(/0x[a-fA-F0-9]{64}/);
  return m ? m[0] : null;
}

export function extractBridgeFromChainId(args: { fromChainId?: unknown; text?: unknown }): number {
  const n = Number(args.fromChainId);
  if (n === 1 || n === 8453 || n === 16661) return n;
  const text = String(args.text ?? "").toLowerCase();
  const from = text.match(/\bfrom\s+(0g|aristotle|base|ethereum|eth)\b/);
  const named = chainForKey(from?.[1]);
  if (named) return named.chainId;
  if (/(\d+(?:\.\d+)?)\s*(?:native\s+)?(?:w)?0g\b/.test(text)) return 16661;
  if (/\b(?:to|on)\s+(base|ethereum|\beth\b)/.test(text) && /\b0g\b/.test(text)) return 16661;
  if (/\bethereum\b|\beth\b/.test(text)) return 1;
  return 8453;
}

export function extractBridgeToChainId(args: { toChainId?: unknown; text?: unknown }, fromChainId: number): number {
  const n = Number(args.toChainId);
  if (n === 1 || n === 8453 || n === 16661) return n;
  const text = String(args.text ?? "").toLowerCase();
  const to = text.match(/\b(?:to|on)\s+(0g|aristotle|base|ethereum|eth)\b/);
  const named = chainForKey(to?.[1]);
  if (named) return named.chainId;
  return fromChainId === LIFI_ZEROG_CHAIN ? 8453 : LIFI_ZEROG_CHAIN;
}

export function isNativeBridgeToken(token: string | undefined): boolean {
  return !token || token.toLowerCase() === NATIVE_0G;
}
