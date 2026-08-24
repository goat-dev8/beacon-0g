import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { AppError, ZEROG_INFERENCE, loadEnv, type BeaconEnv } from "@beacon/shared";
import { recoverTeeSigner, verifyEip191 } from "./eip191.js";

const GET_SERVICE_ABI = [
  "function getService(address provider) view returns (tuple(address provider, string serviceType, string url, uint256 inputPrice, uint256 outputPrice, uint256 updatedAt, string model, string verifiability, string additionalInfo, address teeSignerAddress, bool teeSignerAcknowledged))",
];

export type OnchainInferenceService = {
  url: string;
  model: string;
  verifiability: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
  additionalInfo: string;
};

export type IndependentTeeProof = {
  processResponse: boolean | null;
  eip191Ok: boolean | null;
  recoveredSigner: string | null;
  expectedSigner: string | null;
  signedTextHash: string | null;
  signatureUrl: string | null;
};

function signingAddressFromService(svc: OnchainInferenceService): string {
  let signing = svc.teeSignerAddress;
  try {
    const extra = JSON.parse(svc.additionalInfo) as Record<string, unknown>;
    const providerType = String(extra.ProviderType || extra.providerType || "decentralized");
    const separated = extra.TargetSeparated === true || extra.targetSeparated === true;
    const target = (extra.TargetTeeAddress || extra.targetTeeAddress) as string | undefined;
    if (separated && providerType !== "centralized" && target) {
      signing = target;
    }
  } catch {
    /* keep on-chain teeSignerAddress */
  }
  return getAddress(signing);
}

export async function readInferenceService(
  providerAddress: string,
  opts: { env?: BeaconEnv; rpc?: JsonRpcProvider } = {},
): Promise<OnchainInferenceService> {
  const env = opts.env ?? loadEnv();
  const rpc = opts.rpc ?? new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const contract = new Contract(env.ZEROG_INFERENCE || ZEROG_INFERENCE, GET_SERVICE_ABI, rpc);
  const raw = await contract.getService(getAddress(providerAddress));
  return {
    url: String(raw.url ?? raw[2] ?? "").replace(/\/$/, ""),
    model: String(raw.model ?? raw[6] ?? ""),
    verifiability: String(raw.verifiability ?? raw[7] ?? ""),
    teeSignerAddress: String(raw.teeSignerAddress ?? raw[9] ?? ""),
    teeSignerAcknowledged: Boolean(raw.teeSignerAcknowledged ?? raw[10]),
    additionalInfo: String(raw.additionalInfo ?? raw[8] ?? ""),
  };
}

export async function fetchProviderSignature(
  serviceUrl: string,
  chatId: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; signature: string }> {
  const url = `${serviceUrl.replace(/\/$/, "")}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new AppError("COMPUTE_FAILED", {
      message: "TEE proof unavailable",
      details: { status: res.status },
    });
  }
  const json = (await res.json()) as Record<string, unknown>;
  const text = typeof json.text === "string" ? json.text : "";
  const signature = typeof json.signature === "string" ? json.signature : "";
  if (!text || !signature) {
    throw new AppError("COMPUTE_FAILED", { message: "TEE proof unavailable" });
  }
  return { text, signature };
}

/**
 * Independent of Router `verify_tee`.
 * Reads on-chain service record, fetches provider signature, EIP-191 recovers signer.
 */
export async function proveTeeIndependently(opts: {
  providerAddress: string;
  chatId: string;
  model?: string;
  expectedContent?: string;
  env?: BeaconEnv;
  fetchImpl?: typeof fetch;
  processResponse?: () => Promise<boolean | null>;
}): Promise<IndependentTeeProof> {
  let processOk: boolean | null = null;
  if (opts.processResponse) {
    try {
      processOk = await opts.processResponse();
    } catch {
      processOk = false;
    }
  }

  const svc = await readInferenceService(opts.providerAddress, { env: opts.env });
  if (!svc.url || !svc.teeSignerAddress) {
    return {
      processResponse: processOk,
      eip191Ok: false,
      recoveredSigner: null,
      expectedSigner: null,
      signedTextHash: null,
      signatureUrl: null,
    };
  }

  const expected = signingAddressFromService(svc);
  const model = opts.model || svc.model;
  const signatureUrl = `${svc.url}/v1/proxy/signature/${opts.chatId}?model=${model}`;
  const { text, signature } = await fetchProviderSignature(svc.url, opts.chatId, model, opts.fetchImpl);
  const recovered = recoverTeeSigner(text, signature);
  const eip191Ok = verifyEip191(text, signature, expected);
  if (opts.expectedContent && text.trim() && opts.expectedContent.trim() && text.trim() !== opts.expectedContent.trim()) {
    return {
      processResponse: processOk,
      eip191Ok: false,
      recoveredSigner: recovered,
      expectedSigner: expected,
      signedTextHash: text.slice(0, 80),
      signatureUrl,
    };
  }

  return {
    processResponse: processOk,
    eip191Ok,
    recoveredSigner: recovered,
    expectedSigner: expected,
    signedTextHash: text.slice(0, 80),
    signatureUrl,
  };
}
