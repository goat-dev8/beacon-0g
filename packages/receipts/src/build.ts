import { format0g, newId } from "@beacon/shared";

export interface ReceiptOfferBinding {
  offerId: string;
  briefHash: string;
  rubricHash: string;
  quoteHash: string;
  amount0g: string;
  modelId?: string;
  catalogHash?: string;
}

export interface ReceiptAcceptBinding {
  acceptId: string;
  result: "PASS" | "FAIL" | "NEEDS_LOOK";
  confidence: number;
  summary: string;
}

export interface ReceiptPaymentBinding {
  paymentId: string;
  txHash?: string;
  settled: boolean;
  amount0g: string;
  escrowTxHash?: string;
}

export interface ReceiptArtifactRef {
  kind: string;
  uri: string;
  sha256?: string;
}

export interface BeaconReceipt {
  id: string;
  version: "0g-1.0";
  jobId: string;
  serviceId: string;
  createdAt: string;
  chainId: 16661;
  offer: ReceiptOfferBinding;
  accept: ReceiptAcceptBinding;
  payment: ReceiptPaymentBinding;
  proof: {
    storageRoot: string;
    teeSigner: string;
    chatIdHash: string;
    quoteHash: string;
    allowed: boolean;
  };
  artifacts: ReceiptArtifactRef[];
  display: {
    title: string;
    priceDisplay: string;
    statusLabel: string;
  };
}

export interface BuildReceiptInput {
  jobId: string;
  serviceId: string;
  offer: ReceiptOfferBinding;
  accept: ReceiptAcceptBinding;
  payment: ReceiptPaymentBinding;
  storageRoot: string;
  teeSigner: string;
  chatIdHash: string;
  quoteHash: string;
  allowed?: boolean;
  artifacts?: ReceiptArtifactRef[];
  priceDisplay?: string;
}

export function buildReceipt(input: BuildReceiptInput): BeaconReceipt {
  const allowed = input.allowed ?? input.accept.result === "PASS";
  const settled = input.payment.settled && input.accept.result === "PASS";
  return {
    id: newId(),
    version: "0g-1.0",
    jobId: input.jobId,
    serviceId: input.serviceId,
    createdAt: new Date().toISOString(),
    chainId: 16661,
    offer: input.offer,
    accept: input.accept,
    payment: input.payment,
    proof: {
      storageRoot: input.storageRoot,
      teeSigner: input.teeSigner,
      chatIdHash: input.chatIdHash,
      quoteHash: input.quoteHash,
      allowed,
    },
    artifacts: input.artifacts ?? [],
    display: {
      title: `${capitalize(input.serviceId)} job`,
      priceDisplay: input.priceDisplay ?? format0g(BigInt(input.payment.amount0g || "0")),
      statusLabel: settled ? "Paid" : input.accept.result === "FAIL" ? "Not charged" : "Pending",
    },
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function validateReceipt(receipt: BeaconReceipt): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!receipt.id) errors.push("Missing receipt id");
  if (!receipt.jobId) errors.push("Missing job id");
  if (!receipt.offer.offerId) errors.push("Missing offer binding");
  if (!receipt.offer.quoteHash) errors.push("Missing quote hash");
  if (!receipt.offer.amount0g) errors.push("Missing amount0g");
  if (!receipt.accept.acceptId) errors.push("Missing accept binding");
  if (!receipt.payment.paymentId) errors.push("Missing payment binding");
  if (!receipt.proof.storageRoot) errors.push("Missing storageRoot");
  if (!receipt.proof.teeSigner) errors.push("Missing teeSigner");
  if (!receipt.proof.quoteHash) errors.push("Missing proof quoteHash");
  if (receipt.payment.settled && receipt.accept.result !== "PASS") {
    errors.push("Settled payment requires PASS accept result");
  }
  if ("amountUsdt0" in (receipt.payment as object)) {
    errors.push("USDT0 is not a 0G receipt field");
  }
  return { valid: errors.length === 0, errors };
}
