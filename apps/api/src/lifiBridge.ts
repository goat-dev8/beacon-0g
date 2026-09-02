import { AppError } from "@beacon/shared";

const LIFI = "https://li.quest/v1";

/** Official 0G docs: LI.FI supports chain key zerog / 16661. */
export const LIFI_ZEROG_CHAIN = 16661;

export const BRIDGE_SOURCES: Record<string, { chainId: number; name: string; usdc: string }> = {
  base: { chainId: 8453, name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  ethereum: { chainId: 1, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  eth: { chainId: 1, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
};

/** 0G USDC.e (CCIP/Stargate bridged). */
export const ZEROG_USDCE = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";

export type ParsedBridgeIntent = {
  sourceKey: string;
  sourceChainId: number;
  sourceName: string;
  fromToken: string;
  toToken: string;
  amountAtomic: string;
  amountDisplay: string;
};

export function parseBridgeIntent(text: string): ParsedBridgeIntent | null {
  const lower = text.toLowerCase();
  if (!/\bbridge\b/.test(lower)) return null;
  let sourceKey: string | null = null;
  for (const key of Object.keys(BRIDGE_SOURCES)) {
    if (lower.includes(key)) {
      sourceKey = key === "eth" ? "ethereum" : key;
      break;
    }
  }
  if (!sourceKey || !BRIDGE_SOURCES[sourceKey]) return null;
  const src = BRIDGE_SOURCES[sourceKey];
  const amt = lower.match(/(\d+(?:\.\d+)?)\s*usdc/);
  const amountDisplay = amt?.[1] ?? "1";
  const [whole, frac = ""] = amountDisplay.split(".");
  const atomic = BigInt(whole) * 10n ** 6n + BigInt((frac + "000000").slice(0, 6));
  if (atomic <= 0n) return null;
  return {
    sourceKey,
    sourceChainId: src.chainId,
    sourceName: src.name,
    fromToken: src.usdc,
    toToken: ZEROG_USDCE,
    amountAtomic: atomic.toString(),
    amountDisplay,
  };
}

export type LifiQuoteCard = {
  type: "bridge_quote";
  title: string;
  tool: string;
  source: string;
  destination: "0G Aristotle";
  assetIn: string;
  assetOut: string;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  etaSeconds: number;
  feeSummary: string;
  fromChainId: number;
  toChainId: number;
  approvalAddress: string | null;
  transactionRequest: { to: string; data: string; value: string; chainId: number } | null;
  executableFromBeaconSafe: false;
  executableFromUserWallet: boolean;
  requiredSignatures: string[];
  honesty: string;
  quoteId: string;
  fromToken: string;
  amountAtomic: string;
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

export async function quoteLifiBridge(
  intent: ParsedBridgeIntent,
  fromAddress: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LifiQuoteCard> {
  const url = new URL(`${LIFI}/quote`);
  url.searchParams.set("fromChain", String(intent.sourceChainId));
  url.searchParams.set("toChain", String(LIFI_ZEROG_CHAIN));
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
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 400));
    ({ res, body } = await once());
  }
  if (!res.ok) {
    const msg =
      typeof body.message === "string"
        ? body.message
        : `LI.FI quote failed (${res.status}).`;
    throw new AppError("NO_FIT", { message: msg });
  }
  const estimate = (body.estimate as Record<string, unknown> | undefined) ?? {};
  const action = (body.action as Record<string, unknown> | undefined) ?? {};
  const fromTok = (action.fromToken as { symbol?: string } | undefined)?.symbol ?? "USDC";
  const toTok = (action.toToken as { symbol?: string } | undefined)?.symbol ?? "USDC.e";
  const tx = body.transactionRequest as
    | { to?: string; data?: string; value?: string; chainId?: number }
    | undefined;
  const hasTx = Boolean(tx?.to && tx?.data);
  const toAmount = String(estimate.toAmount ?? "0");
  const toAmountMin = String(estimate.toAmountMin ?? toAmount);
  const decimals = 6;
  const fmt = (raw: string) => (Number(raw) / 10 ** decimals).toString();
  return {
    type: "bridge_quote",
    title: `Bridge ${fromTok} ${intent.sourceName} → 0G`,
    tool: String(body.tool ?? "lifi"),
    source: intent.sourceName,
    destination: "0G Aristotle",
    assetIn: fromTok,
    assetOut: toTok,
    amountIn: intent.amountDisplay,
    estimatedOut: fmt(toAmount),
    minOut: fmt(toAmountMin),
    etaSeconds: Number(estimate.executionDuration ?? 0),
    feeSummary: feeSummary(estimate) || "See LI.FI quote",
    fromChainId: intent.sourceChainId,
    toChainId: LIFI_ZEROG_CHAIN,
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
    requiredSignatures: hasTx
      ? [`User wallet on ${intent.sourceName} (chain ${intent.sourceChainId}). Beacon Safe cannot sign this.`]
      : ["No executable transactionRequest from LI.FI."],
    honesty:
      "Live LI.FI quote (docs.0g.ai). Beacon Safe lives on Aristotle and cannot sign the source-chain tx. Status is not Complete until LI.FI reports DONE with a destination tx.",
    quoteId: String(body.id ?? ""),
    fromToken: intent.fromToken,
    amountAtomic: intent.amountAtomic,
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
): Promise<LifiStatus> {
  const url = new URL(`${LIFI}/status`);
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", String(fromChainId));
  url.searchParams.set("toChain", String(LIFI_ZEROG_CHAIN));
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
  const complete = status === "DONE" && Boolean(receiving) && sameSource;
  return {
    status: sameSource ? status : "NOT_FOUND",
    sendingTx: sending,
    receivingTx: sameSource ? receiving : null,
    complete,
    honesty: complete
      ? "LI.FI status DONE with a destination transaction."
      : !sameSource
        ? "LI.FI did not confirm this source hash. Destination is not complete."
        : `LI.FI status is ${status}. Beacon will not mark the bridge complete until destination is detected.`,
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
  if (n === 1 || n === 8453) return n;
  const text = String(args.text ?? "").toLowerCase();
  if (/\bethereum\b|\beth\b/.test(text)) return 1;
  return 8453;
}
