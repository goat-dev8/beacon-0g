import type { JobQuote } from "@beacon/quote";
import { redisCmd, type RedisRest } from "./flowRedis.js";

const BIGINT_KEYS = [
  "modelCost0g",
  "computeBuffer0g",
  "storage0g",
  "service0g",
  "total0g",
  "minLock0g",
  "lock0g",
] as const;

const IMAGE_B64_MAX = 80_000;

export function serializeQuote(quote: JobQuote): Record<string, unknown> {
  const row: Record<string, unknown> = { ...quote };
  for (const key of BIGINT_KEYS) {
    row[key] = quote[key].toString();
  }
  return row;
}

export function hydrateQuote(raw: Record<string, unknown>): JobQuote {
  const quote = { ...raw } as JobQuote;
  for (const key of BIGINT_KEYS) {
    const value = raw[key];
    quote[key] = typeof value === "bigint" ? value : BigInt(String(value ?? "0"));
  }
  return quote;
}

export function serializeJob<T extends { quote: JobQuote; imageB64?: string }>(job: T): Record<string, unknown> {
  const imageB64 = job.imageB64 && job.imageB64.length > IMAGE_B64_MAX ? undefined : job.imageB64;
  return {
    ...job,
    imageB64,
    quote: serializeQuote(job.quote),
  };
}

export function hydrateJob<T extends { quote: JobQuote }>(raw: Record<string, unknown>): T {
  return {
    ...raw,
    quote: hydrateQuote(raw.quote as Record<string, unknown>),
  } as T;
}

function jobKey(id: string) {
  return `job:${id}`;
}
function quoteKey(id: string) {
  return `job:q:${id}`;
}

export async function putDurableJob(client: RedisRest, job: { id: string; quote: JobQuote; imageB64?: string }) {
  await redisCmd(client, ["SET", jobKey(job.id), JSON.stringify(serializeJob(job))]);
  await redisCmd(client, ["SET", quoteKey(job.quote.quoteId), JSON.stringify(serializeQuote(job.quote))]);
}

export async function getDurableJob<T extends { quote: JobQuote }>(
  client: RedisRest,
  id: string,
): Promise<T | null> {
  const raw = await redisCmd(client, ["GET", jobKey(id)]);
  if (!raw || typeof raw !== "string") return null;
  return hydrateJob<T>(JSON.parse(raw) as Record<string, unknown>);
}

export async function getDurableQuote(client: RedisRest, quoteId: string): Promise<JobQuote | null> {
  const raw = await redisCmd(client, ["GET", quoteKey(quoteId)]);
  if (!raw || typeof raw !== "string") return null;
  return hydrateQuote(JSON.parse(raw) as Record<string, unknown>);
}
