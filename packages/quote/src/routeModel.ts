import { AppError } from "@beacon/shared";
import type { ModelCatalog, RouterModel } from "./catalog.js";

export type ModelTask = "policy" | "cheap" | "vision" | "image" | "video" | "stt";

export type SelectedModel = {
  id: string;
  address: string;
  reason: string;
  verifiability: string;
  trustMode: "private" | "verified";
  model: RouterModel;
};

const UNVERIFIED = /^(claude|gpt)/i;

/** Official GLM 5.2→5.3 TeeML/Private provider. Live Router /v1/models omits `address`. */
export const GLM53_TEEML_PROVIDER = "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D";

function supports(model: RouterModel, param: string): boolean {
  return (model.supported_parameters ?? []).some((p) => p.toLowerCase() === param.toLowerCase());
}

function hasModality(model: RouterModel, which: "input" | "output", modality: string): boolean {
  const list =
    which === "input"
      ? model.architecture?.input_modalities ?? []
      : model.architecture?.output_modalities ?? [];
  return list.map((m) => m.toLowerCase()).includes(modality.toLowerCase());
}

function isTeeMl(model: RouterModel): boolean {
  return model.verifiability.toLowerCase() === "teeml";
}

function isTeeTls(model: RouterModel): boolean {
  return model.verifiability.toLowerCase() === "teetls";
}

function isFrontierUnverified(model: RouterModel): boolean {
  if (UNVERIFIED.test(model.canonical_id) || UNVERIFIED.test(model.model_id)) {
    return model.verifiability.trim() === "";
  }
  return false;
}

function pickByIds(catalog: ModelCatalog, ids: string[], pred: (m: RouterModel) => boolean): RouterModel | undefined {
  for (const id of ids) {
    const hit = catalog.models.find(
      (m) => m.canonical_id.toLowerCase() === id.toLowerCase() && pred(m) && !isFrontierUnverified(m),
    );
    if (hit) return hit;
  }
  return undefined;
}

function cheapestChat(catalog: ModelCatalog, pred: (m: RouterModel) => boolean): RouterModel | undefined {
  const candidates = catalog.models.filter(
    (m) =>
      pred(m) &&
      !isFrontierUnverified(m) &&
      (m.service_type === "chatbot" || m.service_type === ""),
  );
  candidates.sort((a, b) => {
    const pa = BigInt(a.pricing.prompt ?? "0");
    const pb = BigInt(b.pricing.prompt ?? "0");
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  return candidates[0];
}

function selected(model: RouterModel, reason: string): SelectedModel {
  const trustMode: "private" | "verified" = isTeeMl(model) ? "private" : "verified";
  const catalogAddr = model.address?.trim() ?? "";
  const address =
    catalogAddr ||
    (isTeeMl(model) && model.canonical_id.toLowerCase() === "glm-5.3" ? GLM53_TEEML_PROVIDER : "");
  return {
    id: model.canonical_id,
    address,
    reason,
    verifiability: model.verifiability,
    trustMode,
    model,
  };
}

export function selectModel(catalog: ModelCatalog, task: ModelTask): SelectedModel {
  if (task === "policy") {
    const model =
      pickByIds(catalog, ["glm-5.3"], (m) => isTeeMl(m) && (supports(m, "tools") || supports(m, "response_format"))) ??
      catalog.models.find((m) => isTeeMl(m) && supports(m, "tools") && supports(m, "response_format") && !isFrontierUnverified(m));
    if (!model) {
      throw new AppError("NO_FIT", {
        message: "No TeeML tools+JSON model is in the catalog for policy review.",
      });
    }
    return selected(model, "TeeML glm-5.3 (tools+JSON) for Layer 2 policy");
  }

  if (task === "cheap") {
    const preferred =
      pickByIds(catalog, ["qwen3.8-flash", "glm-5.3-flash", "glm-5.3", "qwen3-vl-30b"], (m) => isTeeTls(m)) ??
      pickByIds(catalog, ["glm-5.3-flash", "qwen3.8-flash", "glm-5.3", "qwen3-vl-30b"], (m) => isTeeMl(m));
    const model =
      preferred ??
      cheapestChat(catalog, (m) => (isTeeTls(m) || isTeeMl(m)) && supports(m, "tools"));
    if (!model) {
      throw new AppError("NO_FIT", { message: "No cheap TeeTLS/TeeML chat model in catalog." });
    }
    return selected(model, `cheap classify via ${model.canonical_id} (${model.verifiability})`);
  }

  if (task === "vision") {
    const model =
      pickByIds(catalog, ["0gm-1.0-35b-a3b"], (m) => isTeeMl(m) && hasModality(m, "input", "image")) ??
      catalog.models.find(
        (m) => isTeeMl(m) && hasModality(m, "input", "image") && supports(m, "tools") && !isFrontierUnverified(m),
      );
    if (!model) {
      throw new AppError("NO_FIT", { message: "No TeeML vision+tools model in catalog." });
    }
    return selected(model, "TeeML vision (0gm-1.0-35b-a3b)");
  }

  if (task === "image") {
    const model =
      pickByIds(catalog, ["z-image-turbo"], (m) => isTeeMl(m)) ??
      catalog.models.find(
        (m) =>
          isTeeMl(m) &&
          (m.service_type === "text-to-image" || hasModality(m, "output", "image")) &&
          !isFrontierUnverified(m),
      );
    if (!model) {
      throw new AppError("NO_FIT", { message: "No TeeML image model in catalog." });
    }
    return selected(model, "TeeML text-to-image (z-image-turbo)");
  }

  if (task === "video") {
    const model =
      pickByIds(catalog, ["bytedance/seedance-2.5"], () => true) ??
      catalog.models.find((m) => m.service_type === "video-generation" && !isFrontierUnverified(m));
    if (!model) {
      throw new AppError("NO_FIT", { message: "No video model in catalog." });
    }
    return selected(model, "experimental video (TeeTLS seedance) — not demo-critical");
  }

  if (task === "stt") {
    const model =
      pickByIds(catalog, ["whisper-large-v3"], (m) => isTeeMl(m)) ??
      catalog.models.find((m) => m.service_type === "speech-to-text" && isTeeMl(m));
    if (!model) {
      throw new AppError("NO_FIT", { message: "No TeeML STT model in catalog." });
    }
    return selected(model, "TeeML whisper-large-v3");
  }

  throw new AppError("VALIDATION", { message: `Unknown model task: ${String(task)}` });
}
