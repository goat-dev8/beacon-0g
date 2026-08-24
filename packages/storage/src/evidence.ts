import { JsonRpcProvider, Wallet, keccak256 } from "ethers";
import {
  AppError,
  loadEnv,
  ZEROG_FLOW,
  type BeaconEnv,
} from "@beacon/shared";
import { encryptEvidence, evidenceKeyId } from "./encrypt.js";

export type PutEvidenceResult = {
  rootHash: `0x${string}`;
  txHash?: string;
  txSeq?: number;
  encryptedBytes: number;
  keyId: `0x${string}`;
  contentHash: `0x${string}`;
};

type UploadTuple =
  | [{ txHash: string; rootHash: string; txSeq: number }, Error | null]
  | [{ txHashes: string[]; rootHashes: string[]; txSeqs: number[] }, Error | null];

/**
 * Upload encrypted bytes to 0G Storage via Indexer (turbo) + Flow.submit inside the SDK.
 *
 * If `@0gfoundation/0g-storage-ts-sdk` cannot be imported, this throws.
 * It does **not** keep a successful in-memory copy. Later adapter (documented):
 *   1. Build a padded submission from the ciphertext
 *   2. `Indexer.selectNodes` → upload segments to storage nodes
 *   3. `Flow.submit` payable native 0G at ZEROG_FLOW
 *   4. Return merkle root; verify with `indexer.download(..., proof: true)`
 */
export async function putEvidence(
  bytes: Uint8Array,
  opts: { env?: BeaconEnv; encrypt?: boolean } = {},
): Promise<PutEvidenceResult> {
  const env = opts.env ?? loadEnv();
  const encrypt = opts.encrypt !== false;
  if (!env.ZEROG_EVIDENCE_KEY) {
    throw new AppError("STORAGE_FAILED", {
      message: "ZEROG_EVIDENCE_KEY is required. Evidence keys are never uploaded.",
    });
  }
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) {
    throw new AppError("STORAGE_FAILED", {
      message: "SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK is required for Flow.submit.",
    });
  }

  const payload = encrypt ? encryptEvidence(bytes, env.ZEROG_EVIDENCE_KEY) : bytes;
  const contentHash = keccak256(payload) as `0x${string}`;
  const keyId = evidenceKeyId(env.ZEROG_EVIDENCE_KEY);

  let IndexerCtor: new (url: string) => {
    upload: (
      file: unknown,
      rpc: string,
      signer: Wallet,
    ) => Promise<UploadTuple>;
  };
  let MemDataCtor: new (data: ArrayLike<number>) => unknown;
  try {
    const mod = (await import("@0gfoundation/0g-storage-ts-sdk")) as unknown as {
      Indexer: typeof IndexerCtor;
      MemData: typeof MemDataCtor;
    };
    IndexerCtor = mod.Indexer;
    MemDataCtor = mod.MemData;
  } catch (cause) {
    throw new AppError("STORAGE_FAILED", {
      message:
        "Could not import @0gfoundation/0g-storage-ts-sdk@1.2.11. Refusing in-memory success. Wire Indexer + Flow.submit at " +
        (env.ZEROG_FLOW || ZEROG_FLOW) +
        " against " +
        env.ZEROG_STORAGE_INDEXER +
        ".",
      cause,
    });
  }

  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const signer = new Wallet(pk, provider);
  const indexer = new IndexerCtor(env.ZEROG_STORAGE_INDEXER);
  const file = new MemDataCtor(payload);

  let uploaded: UploadTuple;
  try {
    uploaded = await indexer.upload(file, env.ZEROG_RPC_URL, signer);
  } catch (cause) {
    throw new AppError("STORAGE_FAILED", {
      message: "0G Storage indexer upload threw. Job must fail and refund.",
      cause,
    });
  }

  const [result, err] = uploaded;
  if (err) {
    throw new AppError("STORAGE_FAILED", {
      message: `0G Storage upload failed: ${err.message}`,
      cause: err,
    });
  }

  const root =
    "rootHash" in result ? result.rootHash : result.rootHashes?.[0];
  const txHash = "txHash" in result ? result.txHash : result.txHashes?.[0];
  const txSeq = "txSeq" in result ? result.txSeq : result.txSeqs?.[0];
  if (!root) {
    throw new AppError("STORAGE_FAILED", {
      message: "0G Storage upload returned no merkle root.",
    });
  }

  return {
    rootHash: (root.startsWith("0x") ? root : `0x${root}`) as `0x${string}`,
    txHash,
    txSeq,
    encryptedBytes: payload.byteLength,
    keyId,
    contentHash,
  };
}
