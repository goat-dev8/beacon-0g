import { createHash } from "node:crypto";
import { AbiCoder, ZeroAddress, ZeroHash, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "./hash.js";

const CODER = AbiCoder.defaultAbiCoder();

export type ActionBindingInput = {
  chainId: number;
  jobId: string;
  wallet?: string | null;
  vault?: string | null;
  brief?: string | null;
  policy?: unknown;
  quoteHash?: string | null;
  tee?: {
    allow?: boolean | null;
    reason?: string | null;
    chatId?: string | null;
    recoveredSigner?: string | null;
  } | null;
  storageRoot?: string | null;
  lockTx?: string | null;
  settleTx?: string | null;
  receiptTx?: string | null;
  nonce?: string | number | bigint | null;
  deadline?: string | number | bigint | null;
};

export type ActionBinding = {
  chainId: number;
  jobIdHash: string;
  briefHash: string;
  policyHash: string;
  quoteHash: string;
  teeHash: string;
  storageRoot: string;
  lockTx: string;
  settleTx: string;
  receiptTx: string;
  nonce: string;
  deadline: string;
  actionHash: string;
};

function asBytes32(value: string | null | undefined): string {
  if (!value) return ZeroHash;
  const v = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
  return keccak256(toUtf8Bytes(v));
}

/** Same encoding as the receipt registry: sha256(utf8 job UUID). */
function jobIdHashOf(jobId: string): string {
  const v = jobId.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
  return `0x${createHash("sha256").update(jobId).digest("hex")}`;
}

function asAddress(value: string | null | undefined): string {
  if (!value) return ZeroAddress;
  try {
    return getAddress(value);
  } catch {
    return ZeroAddress;
  }
}

function asUint(value: string | number | bigint | null | undefined): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (/^\d+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

export function hashUtf8(value: string | null | undefined): string {
  return keccak256(toUtf8Bytes(value ?? ""));
}

export function hashPolicySnapshot(policy: unknown): string {
  return keccak256(toUtf8Bytes(JSON.stringify(canonicalize(policy ?? {}))));
}

export function hashTeeVerdict(tee: ActionBindingInput["tee"]): string {
  return keccak256(
    CODER.encode(
      ["bool", "bytes32", "bytes32", "address"],
      [
        Boolean(tee?.allow),
        hashUtf8(tee?.reason ?? ""),
        hashUtf8(tee?.chatId ?? ""),
        asAddress(tee?.recoveredSigner),
      ],
    ),
  );
}

/**
 * keccak256(abi.encode(...)) of the public job fields a verifier needs.
 * Empty / missing values bind as zero — the hash still changes if they later appear.
 */
export function bindAction(input: ActionBindingInput): ActionBinding {
  const jobIdHash = jobIdHashOf(input.jobId);
  const briefHash = hashUtf8(input.brief ?? "");
  const policyHash = hashPolicySnapshot(input.policy ?? {});
  const quoteHash = asBytes32(input.quoteHash);
  const teeHash = hashTeeVerdict(input.tee);
  const storageRoot = asBytes32(input.storageRoot);
  const lockTx = asBytes32(input.lockTx);
  const settleTx = asBytes32(input.settleTx);
  const receiptTx = asBytes32(input.receiptTx);
  const nonce = asUint(input.nonce);
  const deadline = asUint(input.deadline);
  const actionHash = keccak256(
    CODER.encode(
      [
        "uint256",
        "bytes32",
        "address",
        "address",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
      ],
      [
        BigInt(input.chainId),
        jobIdHash,
        asAddress(input.wallet),
        asAddress(input.vault),
        briefHash,
        policyHash,
        quoteHash,
        teeHash,
        storageRoot,
        lockTx,
        settleTx,
        receiptTx,
        nonce,
        deadline,
      ],
    ),
  );
  return {
    chainId: input.chainId,
    jobIdHash,
    briefHash,
    policyHash,
    quoteHash,
    teeHash,
    storageRoot,
    lockTx,
    settleTx,
    receiptTx,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    actionHash,
  };
}
