import { keccak256, toUtf8Bytes } from "ethers";
import {
  AppError,
  applyBps,
  loadEnv,
  newId,
  parse0g,
  parseNeuronString,
  QUOTE_TTL_SECONDS,
  type BeaconEnv,
} from "@beacon/shared";
import type { ModelCatalog, RouterModel } from "./catalog.js";
import { selectModel, type ModelTask, type SelectedModel } from "./routeModel.js";

export type QuoteJobInput = {
  task: ModelTask;
  briefText?: string;
  estimatedPromptTokens?: number;
  estimatedCompletionTokens?: number;
  imageCount?: number;
  audioSeconds?: number;
  videoTokens?: number;
  storage0gWei?: bigint;
};

export type JobQuote = {
  quoteId: string;
  task: ModelTask;
  modelId: string;
  providerAddress: string;
  verifiability: string;
  catalogHash: string;
  pricing: RouterModel["pricing"];
  /** Informational only — never used as lock amount. */
  pricingUsdHint?: string;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  imageCount: number;
  modelCost0g: bigint;
  computeBuffer0g: bigint;
  storage0g: bigint;
  service0g: bigint;
  total0g: bigint;
  minLock0g: bigint;
  lock0g: bigint;
  createdAt: string;
  expiresAt: string;
  quoteHash: string;
  selected: SelectedModel;
};

function defaultTokens(task: ModelTask, briefText: string): { prompt: number; completion: number } {
  const prompt = Math.max(80, Math.ceil(briefText.length / 4) + 40);
  const completion: Record<ModelTask, number> = {
    policy: 256,
    cheap: 128,
    vision: 400,
    image: 0,
    video: 0,
    stt: 0,
  };
  return { prompt, completion: completion[task] };
}

function usdHint(model: RouterModel, task: ModelTask): string | undefined {
  const usd = model.pricing_usd;
  if (!usd) return undefined;
  if (task === "image" && usd.image != null) return `catalog pricing_usd.image=${String(usd.image)} / image`;
  if (usd.prompt != null) return `catalog pricing_usd.prompt=${String(usd.prompt)} per token (not an oracle)`;
  return undefined;
}

function neuronCost(model: RouterModel, input: QuoteJobInput, prompt: number, completion: number): bigint {
  const pricing = model.pricing;
  if (input.task === "image") {
    const n = BigInt(Math.max(1, input.imageCount ?? 1));
    return parseNeuronString(pricing.image) * n;
  }
  if (input.task === "stt") {
    const seconds = BigInt(Math.max(1, Math.ceil(input.audioSeconds ?? 15)));
    return parseNeuronString(pricing.prompt) * seconds;
  }
  if (input.task === "video") {
    const tokens = BigInt(Math.max(1, input.videoTokens ?? 1000));
    const unit = parseNeuronString(pricing.completion);
    return unit * tokens;
  }
  const promptN = parseNeuronString(pricing.prompt) * BigInt(prompt);
  const completionN = parseNeuronString(pricing.completion) * BigInt(completion);
  return promptN + completionN;
}

export function quoteJob(
  catalog: ModelCatalog,
  input: QuoteJobInput,
  env: BeaconEnv = loadEnv(),
): JobQuote {
  if (input.task === "video" && !env.ENABLE_VIDEO) {
    throw new AppError("NO_FIT", {
      message: "Video jobs are disabled (ENABLE_VIDEO=false).",
    });
  }

  const selected = selectModel(catalog, input.task);
  const brief = (input.briefText ?? "").trim();
  const defaults = defaultTokens(input.task, brief);
  const prompt = input.estimatedPromptTokens ?? defaults.prompt;
  const completion = input.estimatedCompletionTokens ?? defaults.completion;
  const imageCount = input.imageCount ?? (input.task === "image" ? 1 : 0);

  const modelCost0g = neuronCost(selected.model, input, prompt, completion);
  const storage0g = input.storage0gWei ?? 0n;
  const computeBuffer0g = applyBps(modelCost0g, env.COMPUTE_BUFFER_BPS);
  const service0g = applyBps(modelCost0g + storage0g, env.PLATFORM_FEE_BPS);
  const summed = modelCost0g + computeBuffer0g + storage0g + service0g;
  const minLock0g = parse0g(env.MIN_JOB_LOCK_0G);
  const lock0g = summed > minLock0g ? summed : minLock0g;

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
  const quoteId = newId();

  const snapshot = {
    quoteId,
    catalogHash: catalog.catalogHash,
    modelId: selected.id,
    providerAddress: selected.address,
    pricing: selected.model.pricing,
    prompt,
    completion,
    modelCost0g: modelCost0g.toString(),
    computeBuffer0g: computeBuffer0g.toString(),
    storage0g: storage0g.toString(),
    service0g: service0g.toString(),
    total0g: summed.toString(),
    minLock0g: minLock0g.toString(),
    fetchedAt: catalog.fetchedAt,
  };
  const quoteHash = keccak256(toUtf8Bytes(JSON.stringify(snapshot)));

  return {
    quoteId,
    task: input.task,
    modelId: selected.id,
    providerAddress: selected.address,
    verifiability: selected.verifiability,
    catalogHash: catalog.catalogHash,
    pricing: selected.model.pricing,
    pricingUsdHint: usdHint(selected.model, input.task),
    estimatedPromptTokens: prompt,
    estimatedCompletionTokens: completion,
    imageCount,
    modelCost0g,
    computeBuffer0g,
    storage0g,
    service0g,
    total0g: summed,
    minLock0g,
    lock0g,
    createdAt,
    expiresAt,
    quoteHash,
    selected,
  };
}
