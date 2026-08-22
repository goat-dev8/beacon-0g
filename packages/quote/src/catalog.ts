import { keccak256, toUtf8Bytes } from "ethers";
import { AppError, ZEROG_ROUTER_URL } from "@beacon/shared";

export type FetchLike = typeof fetch;

export type RouterPricing = {
  prompt?: string;
  completion?: string;
  cached_prompt?: string;
  image?: string;
  video_unit?: string;
  variants?: unknown;
};

export type RouterModel = {
  address: string;
  canonical_id: string;
  model_id: string;
  name: string;
  service_type: string;
  is_healthy: boolean;
  pricing: RouterPricing;
  pricing_usd?: Record<string, unknown>;
  verifiability: string;
  trust_mode?: string;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

export type ModelCatalog = {
  fetchedAt: string;
  models: RouterModel[];
  catalogHash: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeModel(raw: unknown): RouterModel | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const canonical = str(rec.canonical_id) || str(rec.model_id) || str(rec.id);
  if (!canonical) return null;
  const pricingRaw = asRecord(rec.pricing) ?? {};
  return {
    address: str(rec.address),
    canonical_id: canonical,
    model_id: str(rec.model_id, canonical),
    name: str(rec.name, canonical),
    service_type: str(rec.service_type) || str(rec.type),
    is_healthy: rec.is_healthy === undefined ? true : bool(rec.is_healthy, true),
    pricing: {
      prompt: pricingRaw.prompt != null ? String(pricingRaw.prompt) : undefined,
      completion: pricingRaw.completion != null ? String(pricingRaw.completion) : undefined,
      cached_prompt: pricingRaw.cached_prompt != null ? String(pricingRaw.cached_prompt) : undefined,
      image: pricingRaw.image != null ? String(pricingRaw.image) : undefined,
      video_unit: pricingRaw.video_unit != null ? String(pricingRaw.video_unit) : undefined,
      variants: pricingRaw.variants,
    },
    pricing_usd: asRecord(rec.pricing_usd) ?? undefined,
    verifiability: str(rec.verifiability),
    trust_mode: str(rec.trust_mode) || undefined,
    supported_parameters: Array.isArray(rec.supported_parameters)
      ? rec.supported_parameters.filter((x): x is string => typeof x === "string")
      : undefined,
    architecture: asRecord(rec.architecture)
      ? {
          input_modalities: Array.isArray(asRecord(rec.architecture)?.input_modalities)
            ? (asRecord(rec.architecture)!.input_modalities as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : undefined,
          output_modalities: Array.isArray(asRecord(rec.architecture)?.output_modalities)
            ? (asRecord(rec.architecture)!.output_modalities as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : undefined,
        }
      : undefined,
  };
}

export function catalogHash(models: RouterModel[]): string {
  const rows = [...models]
    .map((m) => ({
      id: m.canonical_id,
      address: m.address.toLowerCase(),
      pricing: m.pricing,
      verifiability: m.verifiability,
    }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.address.localeCompare(b.address));
  return keccak256(toUtf8Bytes(JSON.stringify(rows)));
}

export function normalizeCatalog(payload: unknown, fetchedAt = new Date().toISOString()): ModelCatalog {
  const rec = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : rec && Array.isArray(rec.data)
      ? rec.data
      : rec && Array.isArray(rec.models)
        ? rec.models
        : null;
  if (!list) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "0G Router model catalog is not a list.",
    });
  }
  const models: RouterModel[] = [];
  for (const item of list) {
    const model = normalizeModel(item);
    if (model) models.push(model);
  }
  if (models.length === 0) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "0G Router model catalog is empty.",
    });
  }
  return { fetchedAt, models, catalogHash: catalogHash(models) };
}

export async function fetchCatalog(
  routerUrl: string = ZEROG_ROUTER_URL,
  fetchImpl: FetchLike = fetch,
): Promise<ModelCatalog> {
  const base = routerUrl.replace(/\/$/, "");
  const res = await fetchImpl(`${base}/v1/models`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: `0G Router /v1/models failed (${res.status}).`,
      details: { status: res.status },
    });
  }
  const json: unknown = await res.json();
  return normalizeCatalog(json);
}
