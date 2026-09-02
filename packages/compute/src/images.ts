import { AppError, loadEnv, type BeaconEnv } from "@beacon/shared";
import type { TrustMode } from "./types.js";

export type ImageGenerationInput = {
  model: string;
  prompt: string;
  trustMode: TrustMode;
  size?: string;
  n?: number;
  providerAddress?: string;
};

export type ImageGenerationResult = {
  jobId: string;
  model: string;
  providerAddress: string | null;
  zgResKey: string | null;
  b64Json: string;
  contentHash: `0x${string}`;
  trustMode: TrustMode;
};

function header(res: Response, name: string): string | null {
  return res.headers.get(name) ?? res.headers.get(name.toLowerCase());
}

function authHeaders(apiKey: string, input: ImageGenerationInput): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "X-0G-Provider-Trust-Mode": input.trustMode,
    "X-0G-Provider-Allow-Fallbacks": "false",
  };
  if (input.providerAddress) headers["X-0G-Provider-Address"] = input.providerAddress;
  return headers;
}

function extractB64(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const inner = rec.data;
  if (Array.isArray(inner) && inner[0] && typeof inner[0] === "object") {
    const first = inner[0] as Record<string, unknown>;
    if (typeof first.b64_json === "string") return first.b64_json;
  }
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const nested = (inner as Record<string, unknown>).data;
    if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
      const first = nested[0] as Record<string, unknown>;
      if (typeof first.b64_json === "string") return first.b64_json;
    }
  }
  if (typeof rec.b64_json === "string") return rec.b64_json;
  return null;
}

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const { createHash } = await import("node:crypto");
  return `0x${createHash("sha256").update(value).digest("hex")}` as `0x${string}`;
}

/**
 * Official Router async image path. No third-party image hosts.
 * POST /v1/async/images/generations then poll /v1/async/jobs/{id}.
 */
export async function generateImage(
  input: ImageGenerationInput,
  opts: { env?: BeaconEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ImageGenerationResult> {
  const env = opts.env ?? loadEnv();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = env.COMPUTE_API_KEY;
  if (!apiKey) {
    throw new AppError("COMPUTE_FAILED", {
      message: "COMPUTE_API_KEY is required for 0G image generation.",
    });
  }

  const base = env.ZEROG_ROUTER_URL.replace(/\/$/, "");
  const body = {
    model: input.model,
    prompt: input.prompt,
    n: input.n ?? 1,
    size: input.size ?? "1024x1024",
    response_format: "b64_json",
  };

  const submit = await fetchImpl(`${base}/v1/async/images/generations`, {
    method: "POST",
    headers: authHeaders(apiKey, input),
    body: JSON.stringify(body),
  });
  let submitJson: Record<string, unknown>;
  try {
    submitJson = (await submit.json()) as Record<string, unknown>;
  } catch (cause) {
    throw new AppError("COMPUTE_FAILED", {
      message: `0G async image submit returned non-JSON (${submit.status}).`,
      cause,
    });
  }
  if (!submit.ok) {
    const errObj = submitJson.error as Record<string, unknown> | undefined;
    const msg =
      (errObj && typeof errObj.message === "string" && errObj.message) ||
      `0G async image submit failed (${submit.status}).`;
    const code = /insufficient balance/i.test(msg) ? "INSUFFICIENT_TREASURY" : "COMPUTE_FAILED";
    throw new AppError(code, {
      message:
        code === "INSUFFICIENT_TREASURY"
          ? "0G Compute treasury could not pay the provider. This is not your Safe balance. Escrow refunds."
          : msg,
      details: { status: submit.status },
    });
  }

  const jobId = String(submitJson.jobId ?? submitJson.id ?? "");
  const provider =
    (typeof submitJson.provider_address === "string" && submitJson.provider_address) ||
    (typeof submitJson.providerAddress === "string" && submitJson.providerAddress) ||
    null;
  if (!jobId) {
    throw new AppError("COMPUTE_FAILED", { message: "0G image job returned no jobId." });
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  let lastJson: Record<string, unknown> = submitJson;
  let zgResKey = header(submit, "ZG-Res-Key");

  while (Date.now() < deadline) {
    const retryAfter = Number(header(submit, "Retry-After") ?? "3");
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 15) * 1000 : 50;
    await new Promise((r) => setTimeout(r, waitMs));

    const qs = new URLSearchParams();
    if (provider) qs.set("provider_address", provider);
    qs.set("model", input.model);
    const poll = await fetchImpl(`${base}/v1/async/jobs/${encodeURIComponent(jobId)}?${qs}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    });
    try {
      lastJson = (await poll.json()) as Record<string, unknown>;
    } catch (cause) {
      throw new AppError("COMPUTE_FAILED", {
        message: `0G image poll returned non-JSON (${poll.status}).`,
        cause,
      });
    }
    zgResKey = header(poll, "ZG-Res-Key") ?? zgResKey;
    const status = String(lastJson.status ?? "").toLowerCase();
    if (status === "failed" || status === "error") {
      throw new AppError("COMPUTE_FAILED", {
        message: "Generation failed. You were not charged.",
        details: { jobId, status },
      });
    }
    if (status === "completed" || status === "succeeded" || extractB64(lastJson) || extractB64(lastJson.data)) {
      break;
    }
  }

  const b64 = extractB64(lastJson) ?? extractB64(lastJson.data);
  if (!b64) {
    throw new AppError("COMPUTE_FAILED", {
      message: "0G image job completed without b64_json. Refusing a fake result.",
      details: { jobId },
    });
  }

  const trace = lastJson.x_0g_trace as Record<string, unknown> | undefined;
  const traceProvider =
    (trace && typeof trace.provider === "string" && trace.provider) ||
    (trace && typeof trace.provider_address === "string" && trace.provider_address) ||
    provider;

  return {
    jobId,
    model: input.model,
    providerAddress: traceProvider || provider,
    zgResKey,
    b64Json: b64,
    contentHash: await sha256Hex(b64),
    trustMode: input.trustMode,
  };
}
