import { AppError, loadEnv, type BeaconEnv } from "@beacon/shared";
import type { ChatCompletionResult, ChatCompletionsInput, ChatUsage } from "./types.js";

function header(res: Response, name: string): string | null {
  return res.headers.get(name) ?? res.headers.get(name.toLowerCase());
}

function asUsage(raw: unknown): ChatUsage {
  const rec = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const prompt = Number(rec.prompt_tokens ?? rec.input_tokens ?? 0);
  const completion = Number(rec.completion_tokens ?? rec.output_tokens ?? 0);
  const total = Number(rec.total_tokens ?? prompt + completion);
  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    completionTokens: Number.isFinite(completion) ? completion : 0,
    totalTokens: Number.isFinite(total) ? total : 0,
  };
}

function contentFromChoices(json: Record<string, unknown>): string {
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as Record<string, unknown>;
  const message = first.message as Record<string, unknown> | undefined;
  if (message && typeof message.content === "string") return message.content;
  if (typeof first.text === "string") return first.text;
  return "";
}

function providerFromBody(json: Record<string, unknown>): string | null {
  const trace = json.x_0g_trace as Record<string, unknown> | undefined;
  const addr =
    (typeof json.provider === "string" && json.provider) ||
    (typeof json.provider_address === "string" && json.provider_address) ||
    (trace && typeof trace.provider === "string" && trace.provider) ||
    (trace && typeof trace.provider_address === "string" && trace.provider_address);
  return addr || null;
}

/**
 * Router chat completions. Auth is COMPUTE_API_KEY (Bearer).
 * Trust mode is a header, not a body flag. Fallbacks stay off.
 */
export async function chatCompletions(
  input: ChatCompletionsInput,
  opts: { env?: BeaconEnv; fetchImpl?: typeof fetch } = {},
): Promise<ChatCompletionResult> {
  const env = opts.env ?? loadEnv();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = env.COMPUTE_API_KEY;
  if (!apiKey) {
    throw new AppError("COMPUTE_FAILED", {
      message:
        "COMPUTE_API_KEY is required for Router chat completions (or fund a broker and use SDK headers later).",
    });
  }

  const url = `${env.ZEROG_ROUTER_URL.replace(/\/$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "X-0G-Provider-Trust-Mode": input.trustMode,
    "X-0G-Provider-Allow-Fallbacks": "false",
  };
  if (input.providerAddress) {
    headers["X-0G-Provider-Address"] = input.providerAddress;
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0,
    max_tokens: input.maxTokens ?? 1024,
    // Router-side check only. Independent proof is processResponse + EIP-191.
    verify_tee: true,
  };
  if (input.responseFormat) body.response_format = input.responseFormat;

  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const zgResKey = header(res, "ZG-Res-Key") ?? header(res, "zg-res-key");
  const providerHeader = header(res, "X-0G-Provider-Address");

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch (cause) {
    throw new AppError("COMPUTE_FAILED", {
      message: `0G Router chat/completions returned non-JSON (${res.status}).`,
      cause,
      details: { status: res.status },
    });
  }

  if (!res.ok) {
    const errObj = json.error as Record<string, unknown> | undefined;
    const msg =
      (errObj && typeof errObj.message === "string" && errObj.message) ||
      (typeof json.message === "string" && json.message) ||
      `0G Router chat/completions failed (${res.status}).`;
    const code = /insufficient balance/i.test(msg) ? "INSUFFICIENT_TREASURY" : "COMPUTE_FAILED";
    throw new AppError(code, {
      message:
        code === "INSUFFICIENT_TREASURY"
          ? "0G Compute treasury could not pay the provider. This is not your Safe balance. Escrow refunds."
          : msg,
      details: { status: res.status },
    });
  }

  const id = typeof json.id === "string" ? json.id : "";
  const chatId = zgResKey || id;
  return {
    id,
    model: typeof json.model === "string" ? json.model : input.model,
    content: contentFromChoices(json),
    usage: asUsage(json.usage),
    chatId,
    zgResKey,
    providerAddress: providerHeader || providerFromBody(json),
    trustMode: input.trustMode,
    raw: json,
  };
}

export function usageJson(usage: ChatUsage): string {
  return JSON.stringify({
    input_tokens: usage.promptTokens,
    output_tokens: usage.completionTokens,
  });
}
