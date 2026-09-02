import {
  chatCompletions,
  extractRouterTrace,
  hashRouterTraceClaim,
  usageJson,
  type ChatCompletionResult,
  type ComputeBroker,
  type RouterTrace,
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
  routerTrace?: (RouterTrace & { claimHash: string | null }) | null;
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
  'You recommend ALLOW/DENY for a Beacon vault action. Reply JSON only: {"allow":boolean,"reason":string,"category":string}. The vault still enforces caps. ALLOW catalog jobs (tool cheap, image, infer, policy, vision) that lock the quoted amount0g to the job escrow for Compute + Storage, including research, analysis, inspect, and image briefs, and including explaining an EOA or contract from live RPC. ALLOW quoted Zia swaps of native 0G/W0G within amount0g. DENY theft, unlimited spend, send-to-EOA, mismatched tools, or unconstrained transfers.';

export function isCatalogJobTool(tool: string): boolean {
  return /^(cheap|image|infer|policy|vision|video|stt)$/i.test(tool);
}

function looksLikeTheft(reason: string, category: string, userText = ""): boolean {
  return /theft|unlimited spend|unconstrained|send-to-eoa|drain the safe|mismatched tool|bypass policy|send all|0x0{20,}d+ead/i.test(
    `${reason} ${category} ${userText}`,
  );
}

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

function packTrace(raw: unknown): (RouterTrace & { claimHash: string | null }) | null {
  const trace = extractRouterTrace(raw);
  if (!trace) return null;
  return { ...trace, claimHash: hashRouterTraceClaim(trace) };
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
    routerTrace: partial.routerTrace ?? null,
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
              catalogJob: isCatalogJobTool(input.tool),
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
  const routerTrace = packTrace(completion.raw) ?? (completion.routerTrace
    ? { ...completion.routerTrace, claimHash: hashRouterTraceClaim(completion.routerTrace) }
    : null);
  if (routerTrace?.teeVerified === false) {
    return deny({
      reason: "Router reported tee_verified=false. Independent EIP-191 was not treated as a pass.",
      category: "router_unverified",
      chatId,
      zgResKey: completion.zgResKey,
      providerAddress: completion.providerAddress,
      routerTrace,
    });
  }
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

  const catalogJob = isCatalogJobTool(input.tool);
  const semanticTheft = looksLikeTheft(reason, category, input.userText);
  const finalAllow = semanticTheft ? false : allow === true || catalogJob;
  const finalReason = semanticTheft
    ? reason || "Hard DENY: drain or policy-bypass prompt."
    : finalAllow
      ? allow
        ? reason
        : "Catalog escrow job attested by TeeML. Semantic DENY ignored because this lock is Compute + Storage, not a transfer."
      : reason;
  const finalCategory = semanticTheft ? (category || "theft") : finalAllow ? (allow ? category : "catalog-job") : category;

  return {
    allow: finalAllow,
    reason: finalReason,
    category: finalCategory,
    chatId,
    zgResKey: completion.zgResKey,
    providerAddress: completion.providerAddress,
    processResponse: processOk,
    eip191Ok: true,
    recoveredSigner: independent.recoveredSigner,
    expectedSigner: independent.expectedSigner,
    routerTrace,
  };
}
