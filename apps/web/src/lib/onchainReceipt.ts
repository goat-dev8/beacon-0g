import { decodeFunctionResult, encodeFunctionData, sha256, toBytes, type Hex } from "viem";
import { CONTRACTS, NETWORK } from "./chain";

const RECEIPTS_ABI = [
  {
    type: "function",
    name: "receipts",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      { name: "storageRoot", type: "bytes32" },
      { name: "teeSigner", type: "address" },
      { name: "chatIdHash", type: "bytes32" },
      { name: "quoteHash", type: "bytes32" },
      { name: "allowed", type: "bool" },
      { name: "exists", type: "bool" },
      { name: "recordedAt", type: "uint256" },
      { name: "recorder", type: "address" },
    ],
  },
] as const;

export type BrowserReceipt = {
  exists: boolean;
  storageRoot?: string;
  teeSigner?: string;
  chatIdHash?: string;
  quoteHash?: string;
  allowed?: boolean;
  recordedAt?: string;
  recorder?: string;
  rpc: string;
  registry: string;
  jobKey: string;
};

export type ApiReceipt = {
  exists?: boolean;
  storageRoot?: string;
  teeSigner?: string;
  quoteHash?: string;
  allowed?: boolean;
} | null;

/** Same encoding as the API settler: sha256(utf8 job UUID) → bytes32. */
export function jobIdBytes32(jobId: string): Hex {
  const v = jobId.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase() as Hex;
  return sha256(toBytes(v));
}

function norm(value?: string | boolean | null): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "").toLowerCase();
}

export function compareReceipts(
  api: ApiReceipt,
  browser: BrowserReceipt,
): { match: boolean | null; note: string } {
  if (!browser.exists && !api?.exists) {
    return { match: null, note: "No registry row from live RPC yet." };
  }
  if (browser.exists && !api?.exists) {
    return { match: false, note: "Live RPC has a registry row. API did not. Registry wins." };
  }
  if (!browser.exists && api?.exists) {
    return { match: false, note: "API claims a registry row. Live RPC does not. Registry (RPC) wins." };
  }
  const fields: Array<keyof Pick<BrowserReceipt, "storageRoot" | "quoteHash" | "allowed" | "teeSigner">> = [
    "storageRoot",
    "quoteHash",
    "allowed",
    "teeSigner",
  ];
  const mismatch = fields.filter((f) => norm(api?.[f] as string | boolean | undefined) !== norm(browser[f]));
  if (mismatch.length) {
    return {
      match: false,
      note: `Live RPC disagrees with API on ${mismatch.join(", ")}. Registry wins.`,
    };
  }
  return { match: true, note: "Browser eth_call matches the API decode of the same registry." };
}

export async function readReceiptFromRpc(jobId: string): Promise<BrowserReceipt> {
  const jobKey = jobIdBytes32(jobId);
  const data = encodeFunctionData({ abi: RECEIPTS_ABI, functionName: "receipts", args: [jobKey] });
  const res = await fetch(NETWORK.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: CONTRACTS.jobRegistry, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!json.result) throw new Error(json.error?.message ?? "eth_call empty");
  const decoded = decodeFunctionResult({
    abi: RECEIPTS_ABI,
    functionName: "receipts",
    data: json.result as Hex,
  });
  const exists = Boolean(decoded[5]);
  return {
    exists,
    storageRoot: exists ? String(decoded[0]) : undefined,
    teeSigner: exists ? String(decoded[1]) : undefined,
    chatIdHash: exists ? String(decoded[2]) : undefined,
    quoteHash: exists ? String(decoded[3]) : undefined,
    allowed: exists ? Boolean(decoded[4]) : undefined,
    recordedAt: exists ? decoded[6].toString() : undefined,
    recorder: exists ? String(decoded[7]) : undefined,
    rpc: NETWORK.rpc,
    registry: CONTRACTS.jobRegistry,
    jobKey,
  };
}
