import { format0g } from "@beacon/shared";
import type { JobQuote, ModelTask } from "@beacon/quote";

export type DeskServiceId =
  | "video"
  | "image"
  | "presentations"
  | "coding"
  | "research"
  | "documents"
  | "marketing"
  | "design"
  | "ui"
  | "branding"
  | "analysis"
  | "planning"
  | "agents";

export function serviceIdToTask(serviceId: string): ModelTask {
  const s = serviceId.toLowerCase();
  if (s === "video") return "video";
  if (["image", "design", "branding", "ui", "presentations"].includes(s)) return "image";
  return "cheap";
}

export function webQuoteDto(q: JobQuote) {
  return {
    quoteId: q.quoteId,
    priceDisplay: format0g(q.lock0g).replace(/ 0G$/, ""),
    etaSeconds: q.task === "image" ? 120 : 45,
    includes: [q.modelId, "TeeML review", "0G Storage evidence"],
    expiresAt: q.expiresAt,
    capability: "FIT" as const,
    breakdown: {
      model: q.modelId,
      inputTokens: 0,
      outputTokens: 0,
      modelCostUsdt0: format0g(q.modelCost0g).replace(/ 0G$/, ""),
      infraCostUsdt0: format0g(q.storage0g).replace(/ 0G$/, ""),
      platformFeeUsdt0: format0g(q.service0g).replace(/ 0G$/, ""),
      networkFeeUsdt0: "0",
      totalUsdt0: format0g(q.lock0g).replace(/ 0G$/, ""),
    },
  };
}

export function webJobRow(job: {
  id: string;
  status: string;
  task: string;
  brief: string;
  createdAt: string;
  receiptTx?: string;
  serviceId?: string;
}) {
  return {
    id: job.id,
    user_id: null,
    service_id: (job.serviceId ?? (job.task === "image" ? "image" : "research")) as DeskServiceId,
    status: job.status,
    brief_text: job.brief,
    created_at: job.createdAt,
    updated_at: job.createdAt,
    receipt_id: job.receiptTx ?? null,
  };
}

export const ZEROG_SERVICES: Array<{ id: DeskServiceId; name: string; description: string }> = [
  {
    id: "image",
    name: "Image",
    description: "z-image-turbo on 0G Compute. Merkle proof on Storage. Lock native 0G.",
  },
  {
    id: "research",
    name: "Research",
    description: "Cheapest verified TeeML chat model from the live catalog. Quotes in 0G.",
  },
  {
    id: "coding",
    name: "Coding",
    description: "Code via live 0G Compute. Escrow native 0G; refund if generation fails.",
  },
  {
    id: "documents",
    name: "Documents",
    description: "Long-form via 0G Compute. Storage root on pass.",
  },
];
