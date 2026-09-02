import { Interface, formatEther, formatUnits, getAddress, type Provider } from "ethers";
import { CHAIN_ID, ZEROG_EXPLORER } from "@beacon/shared";
import { ZIA_DOC_TOKENS } from "@beacon/swap";

const ERC20 = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function implementation() view returns (address)",
]);

const SELECTORS: Array<{ id: string; hex: string }> = [
  { id: "erc20.balanceOf", hex: "70a08231" },
  { id: "erc20.transfer", hex: "a9059cbb" },
  { id: "erc20.approve", hex: "095ea7b3" },
  { id: "erc165.supportsInterface", hex: "01ffc9a7" },
  { id: "ownable.owner", hex: "8da5cb5b" },
  { id: "pausable.pause", hex: "8456cb59" },
  { id: "uups.upgradeTo", hex: "3659cfe6" },
  { id: "proxy.implementation", hex: "5c60da1b" },
];

export type AddressInspect = {
  address: string;
  chainId: number;
  explorer: string;
  bytecodeBytes: number;
  isContract: boolean;
  nativeBalanceWei: string;
  nativeBalance0g: string;
  token?: { name?: string; symbol?: string; decimals?: number; totalSupply?: string };
  tokenBalances?: Array<{ symbol: string; address: string; balance: string }>;
  owner?: string | null;
  implementation?: string | null;
  selectorsPresent: string[];
  verifiedSource: false;
  verifiedNote: string;
  risks: string[];
};

export type TxInspect = {
  hash: string;
  chainId: number;
  explorer: string;
  status: "success" | "reverted" | "pending" | "not_found";
  from?: string;
  to?: string | null;
  nativeValueWei?: string;
  gasUsed?: string;
  selector?: string | null;
  logs?: number;
  transfers?: Array<{
    token?: string;
    symbol?: string;
    from?: string;
    to?: string;
    value?: string;
    display?: string;
  }>;
};

function explorerAddress(addr: string) {
  return `${ZEROG_EXPLORER}/address/${addr}`;
}
function explorerTx(hash: string) {
  return `${ZEROG_EXPLORER}/tx/${hash}`;
}

export async function inspectAddress(provider: Provider, raw: string): Promise<AddressInspect> {
  const address = getAddress(raw.toLowerCase());
  const [code, balance] = await Promise.all([provider.getCode(address), provider.getBalance(address)]);
  const bytecodeBytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
  const isContract = bytecodeBytes > 0;
  const lowered = (code || "").toLowerCase();
  const selectorsPresent = isContract
    ? SELECTORS.filter((s) => lowered.includes(s.hex)).map((s) => s.id)
    : [];

  let token: AddressInspect["token"];
  if (isContract && selectorsPresent.includes("erc20.balanceOf")) {
    token = {};
    try {
      const rawName = await provider.call({ to: address, data: ERC20.encodeFunctionData("name") });
      token.name = ERC20.decodeFunctionResult("name", rawName)[0] as string;
    } catch {
      /* unverified / non-string */
    }
    try {
      const rawSym = await provider.call({ to: address, data: ERC20.encodeFunctionData("symbol") });
      token.symbol = ERC20.decodeFunctionResult("symbol", rawSym)[0] as string;
    } catch {
      /* skip */
    }
    try {
      const rawDec = await provider.call({ to: address, data: ERC20.encodeFunctionData("decimals") });
      token.decimals = Number(ERC20.decodeFunctionResult("decimals", rawDec)[0]);
    } catch {
      /* skip */
    }
    try {
      const rawSupply = await provider.call({ to: address, data: ERC20.encodeFunctionData("totalSupply") });
      token.totalSupply = ERC20.decodeFunctionResult("totalSupply", rawSupply)[0].toString();
    } catch {
      /* skip */
    }
  }

  const risks: string[] = [];
  if (!isContract) {
    risks.push("This is an EOA (no bytecode). It is not a contract.");
  } else {
    if (selectorsPresent.includes("uups.upgradeTo") || selectorsPresent.includes("proxy.implementation")) {
      risks.push(
        "Bytecode contains upgrade/proxy selectors. An admin may be able to change implementation. Source is not verified here.",
      );
    }
    if (selectorsPresent.includes("pausable.pause")) {
      risks.push("Bytecode contains pause selector. Transfers could be halted if that function is exposed.");
    }
    if (selectorsPresent.includes("ownable.owner")) {
      risks.push("Bytecode contains owner selector. Privileged control may exist.");
    }
    if (selectorsPresent.length === 0) {
      risks.push("No common ERC/admin selectors detected in bytecode. Behavior is unknown without verified source.");
    }
  }

  let owner: string | null = null;
  let implementation: string | null = null;
  if (isContract && selectorsPresent.includes("ownable.owner")) {
    try {
      const raw = await provider.call({ to: address, data: ERC20.encodeFunctionData("owner") });
      owner = ERC20.decodeFunctionResult("owner", raw)[0] as string;
    } catch {
      owner = null;
    }
  }
  if (isContract && selectorsPresent.includes("proxy.implementation")) {
    try {
      const raw = await provider.call({ to: address, data: ERC20.encodeFunctionData("implementation") });
      implementation = ERC20.decodeFunctionResult("implementation", raw)[0] as string;
    } catch {
      implementation = null;
    }
  }

  const tokenBalances: AddressInspect["tokenBalances"] = [];
  const seen = new Set<string>();
  for (const tok of ZIA_DOC_TOKENS) {
    if (tok.native || seen.has(tok.address.toLowerCase())) continue;
    seen.add(tok.address.toLowerCase());
    try {
      const raw = await provider.call({
        to: tok.address,
        data: ERC20.encodeFunctionData("balanceOf", [address]),
      });
      const bal = ERC20.decodeFunctionResult("balanceOf", raw)[0] as bigint;
      if (bal > 0n) {
        const decimals = tok.docsDecimals ?? 18;
        tokenBalances.push({
          symbol: tok.symbol,
          address: tok.address,
          balance: (Number(bal) / 10 ** decimals).toString(),
        });
      }
    } catch {
      /* token may not exist or call reverts */
    }
  }

  return {
    address,
    chainId: CHAIN_ID,
    explorer: explorerAddress(address),
    bytecodeBytes,
    isContract,
    nativeBalanceWei: balance.toString(),
    nativeBalance0g: formatEther(balance),
    token,
    tokenBalances,
    owner,
    implementation,
    selectorsPresent,
    verifiedSource: false,
    verifiedNote: "Beacon does not invent ABIs. Verified source was not fetched; treat selector hints as incomplete.",
    risks,
  };
}

export async function inspectTransaction(provider: Provider, hash: string): Promise<TxInspect> {
  const txHash = hash.startsWith("0x") ? hash : `0x${hash}`;
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx && !receipt) {
    return { hash: txHash, chainId: CHAIN_ID, explorer: explorerTx(txHash), status: "not_found" };
  }
  if (tx && !receipt) {
    return {
      hash: txHash,
      chainId: CHAIN_ID,
      explorer: explorerTx(txHash),
      status: "pending",
      from: tx.from,
      to: tx.to,
      nativeValueWei: tx.value.toString(),
      selector: tx.data && tx.data.length >= 10 ? tx.data.slice(0, 10) : null,
    };
  }
  const status = receipt?.status === 1 ? "success" : "reverted";
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const transfers = (receipt?.logs ?? [])
    .filter((log) => log.topics?.[0]?.toLowerCase() === transferTopic && log.topics.length >= 3)
    .slice(0, 8)
    .map((log) => {
      const token = log.address;
      const known =
        ZIA_DOC_TOKENS.find(
          (t) =>
            !t.native &&
            t.symbol === "USDC.e" &&
            t.address.toLowerCase() === token.toLowerCase(),
        ) ??
        ZIA_DOC_TOKENS.find((t) => !t.native && t.address.toLowerCase() === token.toLowerCase());
      const value = log.data && log.data !== "0x" ? BigInt(log.data).toString() : undefined;
      const decimals = known?.docsDecimals ?? 18;
      return {
        token,
        symbol: known?.symbol,
        from: `0x${log.topics[1].slice(26)}`,
        to: `0x${log.topics[2].slice(26)}`,
        value,
        display: value && known ? `${formatUnits(value, decimals)} ${known.symbol}` : undefined,
      };
    });
  return {
    hash: txHash,
    chainId: CHAIN_ID,
    explorer: explorerTx(txHash),
    status,
    from: receipt?.from ?? tx?.from,
    to: receipt?.to ?? tx?.to ?? null,
    nativeValueWei: tx?.value?.toString(),
    gasUsed: receipt?.gasUsed?.toString(),
    selector: tx?.data && tx.data.length >= 10 ? tx.data.slice(0, 10) : null,
    logs: receipt?.logs.length ?? 0,
    transfers,
  };
}
