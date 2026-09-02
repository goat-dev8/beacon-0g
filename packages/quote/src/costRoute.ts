import { applyBps, loadEnv, parse0g, parseNeuronString, type BeaconEnv } from "@beacon/shared";
import type { ModelCatalog, RouterModel } from "./catalog.js";
import { selectModel } from "./routeModel.js";

export type ChatCostOption = {
  modelId: string;
  providerAddress: string;
  verifiability: string;
  lock0g: bigint;
  modelCost0g: bigint;
  selected: boolean;
};

function chatLock(model: RouterModel, prompt: number, completion: number, env: BeaconEnv): { lock0g: bigint; modelCost0g: bigint } {
  const modelCost0g =
    parseNeuronString(model.pricing.prompt) * BigInt(prompt) +
    parseNeuronString(model.pricing.completion) * BigInt(completion);
  const storage0g = 0n;
  const computeBuffer0g = applyBps(modelCost0g, env.COMPUTE_BUFFER_BPS);
  const service0g = applyBps(modelCost0g + storage0g, env.PLATFORM_FEE_BPS);
  const summed = modelCost0g + computeBuffer0g + storage0g + service0g;
  const minLock0g = parse0g(env.MIN_JOB_LOCK_0G);
  return { modelCost0g, lock0g: summed > minLock0g ? summed : minLock0g };
}

/** Live catalog chat options, cheapest first. Only TeeTLS/TeeML chatbot rows. */
export function listCheapChatOptions(
  catalog: ModelCatalog,
  briefText: string,
  env: BeaconEnv = loadEnv(),
): ChatCostOption[] {
  const selected = selectModel(catalog, "cheap");
  const prompt = Math.max(80, Math.ceil(briefText.length / 4) + 40);
  const completion = 128;
  const rows = catalog.models.filter((m) => {
    const v = m.verifiability.toLowerCase();
    if (v !== "teeml" && v !== "teetls") return false;
    if (m.service_type && m.service_type !== "chatbot") return false;
    return true;
  });
  rows.sort((a, b) => {
    const pa = BigInt(a.pricing.prompt ?? "0");
    const pb = BigInt(b.pricing.prompt ?? "0");
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  const seen = new Set<string>();
  const options: ChatCostOption[] = [];
  for (const model of rows) {
    if (seen.has(model.canonical_id)) continue;
    seen.add(model.canonical_id);
    const cost = chatLock(model, prompt, completion, env);
    options.push({
      modelId: model.canonical_id,
      providerAddress: model.address,
      verifiability: model.verifiability,
      lock0g: cost.lock0g,
      modelCost0g: cost.modelCost0g,
      selected: model.canonical_id === selected.id,
    });
    if (options.length >= 4) break;
  }
  if (!options.some((o) => o.selected)) {
    const cost = chatLock(selected.model, prompt, completion, env);
    options.unshift({
      modelId: selected.id,
      providerAddress: selected.address,
      verifiability: selected.verifiability,
      lock0g: cost.lock0g,
      modelCost0g: cost.modelCost0g,
      selected: true,
    });
  }
  return options;
}
