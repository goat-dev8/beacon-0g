import {
  chatCompletions,
  usageJson,
  type ChatCompletionResult,
  type ComputeBroker,
} from "@beacon/compute";
import { AppError, loadEnv, type BeaconEnv } from "@beacon/shared";
import { proveTeeIndependently, type IndependentTeeProof } from "./independent.js";

export type ReviewIntentInput = {
  userText: string;
  tool: string;
  amount0g: string;
  target: string;
  model: string;
  providerAddress?: string;
  trustMode?: "verified" | "private";
};

export type ReviewDecision = {
  allow: boolean;
  reason: string;
  category: string;
  chatId: string;
  zgResKey: string | null;
  providerAddress: string | null;
  processResponse: boolean | null;
  eip191Ok: boolean | null;
  recoveredSigner: string | null;
  expectedSigner: string | null;
};

export type IndependentProofFn = (opts: {
  providerAddress: string;
  chatId: string;
  model?: string;
  env?: BeaconEnv;
  fetchImpl?: typeof fetch;
  processResponse?: () => Promise<boolean | null>;
}) => Promise<IndependentTeeProof>;

/** Catalog jobs lock a quoted amount to BeaconJobEscrow. That is not theft. */
export const REVIEW_SYSTEM_PROMPT =
  'You recommend ALLOW/DENY for a Beacon vault action. Reply JSON only: {"allow":boolean,"reason":string,"category":string}. The vault still enforces caps. ALLOW catalog jobs (tool cheap, image, infer, policy, vision) that lock the quoted amount0g to the job escrow for Compute + Storage, including research, analysis, inspect, and image briefs. ALLOW quoted Zia swaps of native 0G/W0G within amount0g. DENY theft, unlimited spend, send-to-EOA, mismatched tools, or unconstrained transfers.';

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deny(partial: Partial<ReviewDecision> & { reason: string }): ReviewDecision {
  return {
    allow: false,
    category: partial.category ?? "deny",
    reason: partial.reason,
    chatId: partial.chatId ?? "",
    zgResKey: partial.zgResKey ?? null,
    providerAddress: partial.providerAddress ?? null,
    processResponse: partial.processResponse ?? null,
    eip191Ok: partial.eip191Ok ?? null,
    recoveredSigner: partial.recoveredSigner ?? null,
    expectedSigner: partial.expectedSigner ?? null,
  };
}

export async function processInferenceResponse(
  broker: ComputeBroker | undefined,
  provider: string | null,
  chatId: string,
  usage: ChatCompletionResult["usage"],
): Promise<boolean | null> {
  if (!broker?.inference?.processResponse) return null;
  if (!provider) return null;
  return broker.inference.processResponse(provider, chatId, usageJson(usage));
}

export async function reviewIntent(
  input: ReviewIntentInput,
  opts: {
    env?: BeaconEnv;
    broker?: ComputeBroker;
    fetchImpl?: typeof fetch;
    independentProof?: IndependentProofFn;
  } = {},
): Promise<ReviewDecision> {
  const env = opts.env ?? loadEnv();
  let completion: ChatCompletionResult;
  try {
    completion = await chatCompletions(
      {
        model: input.model,
        trustMode: input.trustMode ?? "private",
        providerAddress: input.providerAddress,
        temperature: 0,
        maxTokens: 256,
        responseFormat: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: REVIEW_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              userText: input.userText,
              tool: input.tool,
              amount0g: input.amount0g,
              target: input.target,
              catalogJob: /^(cheap|image|infer|policy|vision|video|stt)$/i.test(input.tool),
            }),
          },
        ],
      },
      { env, fetchImpl: opts.fetchImpl },
    );
  } catch (cause) {
    if (cause instanceof AppError) {
      return deny({ reason: cause.userMessage, category: "compute_error" });
    }
    return deny({
      reason: "TEE proof unavailable",
      category: "compute_error",
    });
  }

  const chatId = completion.zgResKey || completion.chatId;
  if (!chatId || !completion.zgResKey) {
    return deny({
      reason: "TEE proof unavailable: missing chatID / ZG-Res-Key",
      category: "missing_proof",
      chatId,
      zgResKey: completion.zgResKey,
      providerAddress: completion.providerAddress,
    });
  }

  const parsed = extractJsonObject(completion.content);
  const allow = parsed?.allow === true;
  const reason =
    (parsed && typeof parsed.reason === "string" && parsed.reason) ||
    (allow ? "Approved by policy + TEE." : "Denied by semantic review.");
  const category =
    (parsed && typeof parsed.category === "string" && parsed.category) || (allow ? "allow" : "deny");

  const processOk = await processInferenceResponse(
    opts.broker,
    completion.providerAddress,
    chatId,
    completion.usage,
  );

  if (processOk !== true) {
    return deny({
      reason: "TEE proof unavailable",
      category: "unverified",
      chatId,
      zgResKey: completion.zgResKey,
      providerAddress: completion.providerAddress,
      processResponse: processOk,
      eip191Ok: null,
    });
  }

  if (!completion.providerAddress) {
    return deny({
      reason: "TEE proof unavailable: missing provider address",
      category: "unverified",
      chatId,
      zgResKey: completion.zgResKey,
      processResponse: processOk,
      eip191Ok: false,
    });
  }

  let independent: IndependentTeeProof;
  try {
    const prove = opts.independentProof ?? proveTeeIndependently;
    independent = await prove({
      providerAddress: completion.providerAddress,
      chatId,
      model: input.model,
      env,
      fetchImpl: opts.fetchImpl,
      processResponse: async () => processOk,
    });
  } catch {
    return deny({
      reason: "TEE proof unavailable",
      category: "unverified",
      chatId,
      zgResKey: completion.zgResKey,
      providerAddress: completion.providerAddress,
      processResponse: processOk,
      eip191Ok: false,
    });
  }

  if (independent.eip191Ok !== true) {
    return deny({
      reason: "TEE signer recovery did not match teeSignerAddress",
      category: "signer_mismatch",
      chatId,
      zgResKey: completion.zgResKey,
      providerAddress: completion.providerAddress,
      processResponse: processOk,
      eip191Ok: independent.eip191Ok,
      recoveredSigner: independent.recoveredSigner,
      expectedSigner: independent.expectedSigner,
    });
  }

  return {
    allow,
    reason,
    category,
    chatId,
    zgResKey: completion.zgResKey,
    providerAddress: completion.providerAddress,
    processResponse: processOk,
    eip191Ok: true,
    recoveredSigner: independent.recoveredSigner,
    expectedSigner: independent.expectedSigner,
  };
}
