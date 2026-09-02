import { describe, expect, it } from "vitest";
import { parse0g } from "@beacon/shared";
import type { JobQuote } from "@beacon/quote";
import { hydrateJob, hydrateQuote, serializeJob, serializeQuote } from "./jobPersist.js";

const quote = {
  quoteId: "q1",
  task: "image",
  modelId: "z-image-turbo",
  providerAddress: "0x1",
  verifiability: "teeml",
  catalogHash: "0xabc",
  pricing: { prompt: "1", completion: "1" },
  estimatedPromptTokens: 0,
  estimatedCompletionTokens: 0,
  imageCount: 1,
  modelCost0g: parse0g("0.04"),
  computeBuffer0g: parse0g("0.001"),
  storage0g: 0n,
  service0g: parse0g("0.002"),
  total0g: parse0g("0.048"),
  minLock0g: parse0g("0.001"),
  lock0g: parse0g("0.048584"),
  createdAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-09-02T01:00:00.000Z",
  quoteHash: "0xhash",
  selected: {
    id: "z-image-turbo",
    address: "0x1",
    reason: "image",
    verifiability: "teeml",
    trustMode: "verified",
    model: { canonical_id: "z-image-turbo" },
  },
} as unknown as JobQuote;

describe("job persistence", () => {
  it("round-trips bigint lock amounts so a Render restart can still lock", () => {
    const json = JSON.parse(JSON.stringify(serializeQuote(quote))) as Record<string, unknown>;
    const back = hydrateQuote(json);
    expect(back.lock0g).toBe(parse0g("0.048584"));
    expect(back.modelCost0g).toBe(parse0g("0.04"));
  });

  it("drops oversized image payloads but keeps the job id", () => {
    const job = {
      id: "job-1",
      quote,
      imageB64: "a".repeat(2_000_001),
      status: "QUOTED",
    };
    const stored = serializeJob(job);
    expect(stored.imageB64).toBeUndefined();
    const hydrated = hydrateJob<typeof job>(JSON.parse(JSON.stringify(stored)) as Record<string, unknown>);
    expect(hydrated.id).toBe("job-1");
    expect(hydrated.quote.lock0g).toBe(quote.lock0g);
  });

  it("keeps a typical generated image so the desk can restore it", () => {
    const job = {
      id: "job-2",
      quote,
      imageB64: "a".repeat(120_000),
      status: "PASSED",
    };
    expect(serializeJob(job).imageB64).toHaveLength(120_000);
  });
});
