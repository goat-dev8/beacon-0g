import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  sha256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { CONTRACTS, NETWORK } from "./chain";
import { aristotleEip1559Fees } from "./aristotleFees";

const aristotle = {
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpc] } },
} as const;

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function asEip1193(value: unknown): Eip1193Provider | undefined {
  if (
    value &&
    typeof value === "object" &&
    "request" in value &&
    typeof (value as Eip1193Provider).request === "function"
  ) {
    return value as Eip1193Provider;
  }
  return undefined;
}

/** Active provider from Reown / wagmi connector (injected or WalletConnect). */
let activeEip1193: Eip1193Provider | undefined;

export function setEip1193Provider(provider: Eip1193Provider | null | undefined): void {
  activeEip1193 = provider ?? undefined;
}

export function getEip1193Provider(): Eip1193Provider | undefined {
  if (activeEip1193) return activeEip1193;
  if (typeof window === "undefined") return undefined;
  return asEip1193((window as Window & { ethereum?: unknown }).ethereum);
}

/**
 * Reown AppKit is always available — users can pick MetaMask, Rabby, WC, etc.
 * Kept for call sites that previously gated on injected `window.ethereum`.
 */
export function hasEvmProvider(): boolean {
  return typeof window !== "undefined";
}

export async function ensureAristotleNetwork(): Promise<void> {
  await ensureChain({
    chainId: NETWORK.chainId,
    name: NETWORK.name,
    rpc: NETWORK.rpc,
    explorer: NETWORK.explorer,
    nativeName: "0G",
    nativeSymbol: "0G",
  });
}

/**
 * Beacon jobs, Safe, and Zia stay on Aristotle. Other chains are refused here.
 * LI.FI source-chain signing uses `ensureSourceChain` instead.
 */
export async function ensureForeignMainnet(): Promise<void> {
  throw new Error("Beacon stays on 0G Aristotle (chain 16661). Other networks are disabled.");
}

const SOURCE_CHAINS: Record<
  number,
  { name: string; rpc: string; explorer: string; nativeName: string; nativeSymbol: string }
> = {
  8453: {
    name: "Base",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeName: "Ether",
    nativeSymbol: "ETH",
  },
  1: {
    name: "Ethereum",
    rpc: "https://cloudflare-eth.com",
    explorer: "https://etherscan.io",
    nativeName: "Ether",
    nativeSymbol: "ETH",
  },
};

/**
 * Narrow switch for a live LI.FI quote. Only Base (8453) and Ethereum (1).
 * Always switch back to Aristotle after the source tx is submitted.
 */
export async function ensureSourceChain(chainId: number): Promise<void> {
  const meta = SOURCE_CHAINS[chainId];
  if (!meta) {
    throw new Error(`Beacon will not switch to unsupported source chain ${chainId}.`);
  }
  await ensureChain({
    chainId,
    name: meta.name,
    rpc: meta.rpc,
    explorer: meta.explorer,
    nativeName: meta.nativeName,
    nativeSymbol: meta.nativeSymbol,
  });
}

export type LifiBridgeStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "send"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

/**
 * User-wallet source-chain tx from a live LI.FI transactionRequest.
 * Beacon Safe cannot sign this. Status tracking is a separate LI.FI poll.
 */
export async function executeLifiBridge(params: {
  transactionRequest: { to: string; data: Hex; value: string; chainId: number };
  approvalAddress?: string | null;
  fromToken?: string;
  fromAmount?: string;
  onStep?: (s: LifiBridgeStep) => void;
}): Promise<{ sourceHash: Hex; approveHash?: Hex }> {
  const tx = params.transactionRequest;
  if (!tx.to || !tx.data) {
    throw new Error("LI.FI did not return an executable transactionRequest.");
  }
  await ensureSourceChain(tx.chainId);
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("Wallet returned no account.");

  let approveHash: Hex | undefined;
  const nativeToken = !params.fromToken || /^0x0+$/i.test(params.fromToken);
  if (!nativeToken && params.approvalAddress && params.fromToken && params.fromAmount) {
    const spender = getAddress(params.approvalAddress);
    const token = getAddress(params.fromToken);
    const amount = BigInt(params.fromAmount);
    const allowanceData = encodeFunctionData({
      abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
      functionName: "allowance",
      args: [getAddress(from), spender],
    });
    const raw = (await eth.request({
      method: "eth_call",
      params: [{ to: token, data: allowanceData }, "latest"],
    })) as string;
    const allowance = BigInt(raw || "0x0");
    if (allowance < amount) {
      params.onStep?.({ step: "approve", status: "pending" });
      const approveData = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve",
        args: [spender, amount],
      });
      approveHash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from, to: token, data: approveData }],
      })) as Hex;
      params.onStep?.({ step: "approve", status: "confirmed", hash: approveHash });
    } else {
      params.onStep?.({ step: "approve", status: "skipped" });
    }
  }

  params.onStep?.({ step: "send", status: "pending" });
  try {
    const sourceHash = (await eth.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: tx.to,
          data: tx.data,
          value: tx.value && tx.value !== "0" ? tx.value : "0x0",
        },
      ],
    })) as Hex;
    params.onStep?.({ step: "send", status: "confirmed", hash: sourceHash });
    try {
      await ensureAristotleNetwork();
    } catch {
      /* source tx already sent; Flow can continue even if the switch-back is rejected */
    }
    return { sourceHash, approveHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Source-chain bridge tx failed.";
    params.onStep?.({ step: "send", status: "failed", error: message });
    try {
      await ensureAristotleNetwork();
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
}

async function ensureChain(params: {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  nativeName: string;
  nativeSymbol: string;
}): Promise<void> {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  const targetHex = `0x${params.chainId.toString(16)}` as Hex;
  const chainIdHex = (await eth.request({ method: "eth_chainId" })) as Hex;
  if (parseInt(chainIdHex, 16) === params.chainId) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
    return;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : undefined;
    if (code !== 4902 && code !== -32603) {
      throw new Error(`Switch your wallet to ${params.name} (chain ${params.chainId}).`);
    }
  }

  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: targetHex,
        chainName: params.name,
        nativeCurrency: { name: params.nativeName, symbol: params.nativeSymbol, decimals: 18 },
        rpcUrls: [params.rpc],
        blockExplorerUrls: [params.explorer],
      },
    ],
  });
  await eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetHex }],
  });
}

/**
 * Connect via injected provider when already available.
 * Prefer `useProductWallet().connect()` (Reown modal) for multi-wallet UX.
 */
export async function connectEvmWallet(): Promise<Address> {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts[0]) throw new Error("Wallet returned no account.");
  await ensureAristotleNetwork();
  const addr = getAddress(accounts[0]);
  try {
    localStorage.setItem("beacon.wallet", addr);
  } catch {
    /* ignore */
  }
  return addr;
}

/** Soft restore — eth_accounts (no popup) if previously connected. */
export async function tryRestoreWallet(): Promise<Address | null> {
  const eth = getEip1193Provider();
  if (!eth) {
    try {
      const cached = localStorage.getItem("beacon.wallet");
      return cached && /^0x[a-fA-F0-9]{40}$/.test(cached) ? getAddress(cached) : null;
    } catch {
      return null;
    }
  }
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    if (!accounts[0]) {
      const cached = localStorage.getItem("beacon.wallet");
      return cached && /^0x[a-fA-F0-9]{40}$/.test(cached) ? getAddress(cached) : null;
    }
    await ensureAristotleNetwork();
    const addr = getAddress(accounts[0]);
    localStorage.setItem("beacon.wallet", addr);
    return addr;
  } catch {
    return null;
  }
}

export function walletClient() {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  return createWalletClient({ chain: aristotle, transport: custom(eth) });
}

export function publicClient() {
  const eth = getEip1193Provider();
  return createPublicClient({
    chain: aristotle,
    transport: eth ? custom(eth) : http(NETWORK.rpc),
  });
}

async function withAristotleFees<T extends Record<string, unknown>>(
  tx: T,
): Promise<T & { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const pub = publicClient();
  const fees = await aristotleEip1559Fees({
    getGasPrice: () => pub.getGasPrice(),
    requestMaxPriorityFee: async () => {
      const raw = await pub.request({ method: "eth_maxPriorityFeePerGas" });
      return BigInt(raw as string);
    },
  });
  return { ...tx, ...fees };
}

export type SwapExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "swap"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

export type OftBridgeExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "send"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

/** JAINE / partner DEX paths are disabled. Swaps go through Zia only. */
export async function executeSparkDexSwap(_params: {
  approveTo: Address;
  approveData: Hex;
  swapTo: Address;
  swapData: Hex;
  chainId?: number;
  onStep?: (s: SwapExecutionStep) => void;
}): Promise<{ approveHash?: Hex; swapHash: Hex }> {
  throw new Error("Beacon refused this swap. Only the allowlisted Zia router is permitted.");
}

/** Cross-chain OFT is P3. Honest refuse. */
export async function executeOftBridge(_params: {
  approveTo: Address;
  approveData: Hex;
  sendTo: Address;
  sendData: Hex;
  nativeFee: bigint;
  onStep?: (s: OftBridgeExecutionStep) => void;
}): Promise<{ approveHash?: Hex; sendHash: Hex }> {
  throw new Error("Cross-chain OFT is NOT_AVAILABLE on Beacon 0G P0. Use Zia for 0G→USDC.e on Aristotle.");
}

export function jobIdToBytes32(jobId: string): Hex {
  // Match backend e2e / settler: sha256(utf8 jobId) → bytes32
  return sha256(toBytes(jobId));
}

/** Parse "0.02" → native 0G wei (18 decimals). */
export function parsePriceDisplay(priceDisplay: string): bigint {
  const cleaned = priceDisplay.replace(/[^0-9.]/g, "");
  const [whole = "0", frac = ""] = cleaned.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "000000000000000000").slice(0, 18));
}

export async function getTokenMeta(): Promise<{ name: string; version: string }> {
  return { name: "0G", version: "1" };
}

export function openZeroGFaucet(): void {
  if (typeof window !== "undefined") {
    window.open(NETWORK.faucet, "_blank", "noopener,noreferrer");
  }
}

/** Native 0G only. No mock mint. */
export async function mintMockUsdt0(): Promise<Hex> {
  openZeroGFaucet();
  throw new Error(`Beacon uses native 0G. Get 0G at ${NETWORK.faucet}. In-app mint is disabled.`);
}

export async function getNativeBalance(owner: Address): Promise<bigint> {
  const client = publicClient();
  return client.getBalance({ address: owner });
}

export type AuthorizationPayload = {
  payer: string;
  payee: string;
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
  jobHash: string;
  lockTxHash?: string;
  mode?: string;
};

/** Lock native 0G into BeaconJobEscrow. */
export async function approveJobOnChain(params: {
  jobId: string;
  priceDisplay: string;
}): Promise<AuthorizationPayload> {
  await ensureAristotleNetwork();
  const client = walletClient();
  const pub = publicClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  if (!CONTRACTS.escrow) throw new Error("BeaconJobEscrow is not configured.");

  const amount = parsePriceDisplay(params.priceDisplay);
  const balance = await getNativeBalance(account);
  if (balance < amount) {
    throw new Error(
      `Need ${params.priceDisplay} native 0G. Bridge or buy 0G at ${NETWORK.faucet}.`,
    );
  }

  const jobHash = jobIdToBytes32(params.jobId);
  const lockData = encodeFunctionData({
    abi: parseAbi(["function lockNative(bytes32 jobId)"]),
    functionName: "lockNative",
    args: [jobHash],
  });
  const lockTxHash = await client.sendTransaction(
    await withAristotleFees({
      account,
      to: CONTRACTS.escrow,
      data: lockData,
      value: amount,
      chain: aristotle,
    }),
  );
  const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTxHash });
  if (lockReceipt.status === "reverted") {
    throw new Error("Escrow lockNative reverted. Check 0G balance and try again.");
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    payer: account,
    payee: CONTRACTS.escrow,
    amount: amount.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + 3600),
    nonce: jobHash,
    signature: "0x",
    jobHash,
    lockTxHash,
    mode: "native-lock",
  };
}

/** Deposit native 0G into Beacon Safe (payable deposit / receive). */
export async function executeAgentVaultPrep(params: {
  to: Address;
  data: Hex;
  approveTo?: Address;
  approveData?: Hex;
  mode?: "eip3009" | "approve";
  token?: Address;
  amount?: string;
  action?: string;
}): Promise<{ approveHash?: Hex; txHash: Hex }> {
  await ensureAristotleNetwork();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  if (params.mode === "eip3009") {
    throw new Error("EIP-3009 is not part of the native 0G vault. Send 0G directly.");
  }

  const value =
    params.action === "deposit" && params.amount ? BigInt(params.amount) : 0n;
  if (value > 0n) {
    const balance = await getNativeBalance(account);
    if (balance < value) {
      throw new Error(`Not enough native 0G. Get 0G at ${NETWORK.faucet}`);
    }
  }

  const data =
    params.data && params.data !== "0x"
      ? params.data
      : encodeFunctionData({
          abi: parseAbi(["function deposit()"]),
          functionName: "deposit",
        });

  const txHash = await wallet.sendTransaction(
    await withAristotleFees({
      account,
      to: params.to,
      data,
      value,
      chain: aristotle,
    }),
  );
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    throw new Error("Safe transaction reverted on 0G Aristotle.");
  }
  return { txHash };
}

export async function mintTestUsdt0(): Promise<Hex> {
  openZeroGFaucet();
  throw new Error(`Get native 0G at ${NETWORK.faucet}`);
}

export const getUsdt0Balance = getNativeBalance;

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** personal_sign helper for Beacon Safe pay challenges. */
export async function signPersonalMessage(message: string): Promise<string> {
  const wallet = walletClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  return wallet.signMessage({ account, message });
}

/** Send a prepared createSafe / vault tx (non-EIP-3009). */
export async function sendPreparedVaultTx(params: {
  to: Address;
  data: Hex;
}): Promise<Hex> {
  await ensureAristotleNetwork();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  const txHash = await wallet.sendTransaction(
    await withAristotleFees({
      account,
      to: params.to,
      data: params.data,
      chain: aristotle,
    }),
  );
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    throw new Error("Safe transaction reverted on 0G Aristotle.");
  }
  return txHash;
}
