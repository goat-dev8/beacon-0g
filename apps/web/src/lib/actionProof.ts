import { encodeAbiParameters, keccak256, sha256, toBytes, toHex, type Hex } from "viem";

export type BrowserActionFields = {
  chainId: number;
  jobId: string;
  wallet?: string | null;
  vault?: string | null;
  brief?: string | null;
  policyHash: Hex;
  quoteHash?: string | null;
  teeHash: Hex;
  storageRoot?: string | null;
  lockTx?: string | null;
  settleTx?: string | null;
  receiptTx?: string | null;
  nonce: string;
  deadline: string;
};

function asBytes32(value?: string | null): Hex {
  if (!value) return ("0x" + "00".repeat(32)) as Hex;
  const v = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase() as Hex;
  return keccak256(toBytes(v));
}

function asAddress(value?: string | null): Hex {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    return "0x0000000000000000000000000000000000000000";
  }
  return value.trim() as Hex;
}

function jobIdHashOf(jobId: string): Hex {
  const v = jobId.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase() as Hex;
  return sha256(toBytes(v));
}

/** Same ABI encoding as packages/execution bindAction. */
export function recomputeActionHash(fields: BrowserActionFields): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        BigInt(fields.chainId),
        jobIdHashOf(fields.jobId),
        asAddress(fields.wallet),
        asAddress(fields.vault),
        keccak256(toBytes(fields.brief ?? "")),
        fields.policyHash,
        asBytes32(fields.quoteHash),
        fields.teeHash,
        asBytes32(fields.storageRoot),
        asBytes32(fields.lockTx),
        asBytes32(fields.settleTx),
        asBytes32(fields.receiptTx),
        BigInt(fields.nonce || "0"),
        BigInt(fields.deadline || "0"),
      ],
    ),
  );
}

export function hashUtf8Keccak(value: string): Hex {
  return keccak256(toHex(value));
}
