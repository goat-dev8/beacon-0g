import { Pool } from "pg";
import type { BeaconEnv } from "@beacon/shared";
import * as pgStore from "./flowStore.js";
import * as redisStore from "./flowRedis.js";
import type { RedisRest } from "./flowRedis.js";

export type HistoryKind = "postgres" | "redis";

export type FlowHistory = {
  kind: HistoryKind;
  listConversations: (wallet: string) => ReturnType<typeof pgStore.listConversations>;
  createConversation: (
    wallet: string,
    title?: string,
    agentId?: string,
  ) => ReturnType<typeof pgStore.createConversation>;
  getConversation: (id: string, wallet: string) => ReturnType<typeof pgStore.getConversation>;
  renameConversation: (id: string, wallet: string, title: string) => Promise<void>;
  archiveConversation: (id: string, wallet: string) => Promise<void>;
  pinConversation: (id: string, wallet: string, pinned: boolean) => Promise<void>;
  listMessages: (conversationId: string) => ReturnType<typeof pgStore.listMessages>;
  appendMessage: (
    conversationId: string,
    msg: Parameters<typeof pgStore.appendMessage>[2],
  ) => ReturnType<typeof pgStore.appendMessage>;
  updateConversationState: (conversationId: string, state: unknown, agentId?: string) => Promise<void>;
  recordActivity: (
    wallet: string,
    kind: string,
    title: string,
    meta?: Record<string, unknown>,
    explorerUrl?: string,
    refId?: string,
  ) => Promise<void>;
  listActivity: (wallet: string) => ReturnType<typeof pgStore.listActivity>;
};

function wrapPostgres(pool: Pool): FlowHistory {
  return {
    kind: "postgres",
    listConversations: (wallet) => pgStore.listConversations(pool, wallet),
    createConversation: (wallet, title, agentId) => pgStore.createConversation(pool, wallet, title, agentId),
    getConversation: (id, wallet) => pgStore.getConversation(pool, id, wallet),
    renameConversation: (id, wallet, title) => pgStore.renameConversation(pool, id, wallet, title),
    archiveConversation: (id, wallet) => pgStore.archiveConversation(pool, id, wallet),
    pinConversation: (id, wallet, pinned) => pgStore.pinConversation(pool, id, wallet, pinned),
    listMessages: (conversationId) => pgStore.listMessages(pool, conversationId),
    appendMessage: (conversationId, msg) => pgStore.appendMessage(pool, conversationId, msg),
    updateConversationState: (conversationId, state, agentId) =>
      pgStore.updateConversationState(pool, conversationId, state, agentId),
    recordActivity: (wallet, kind, title, meta, explorerUrl, refId) =>
      pgStore.recordActivity(pool, wallet, kind, title, meta ?? {}, explorerUrl, refId),
    listActivity: (wallet) => pgStore.listActivity(pool, wallet),
  };
}

function wrapRedis(client: RedisRest): FlowHistory {
  return {
    kind: "redis",
    listConversations: (wallet) => redisStore.listConversations(client, wallet),
    createConversation: (wallet, title, agentId) => redisStore.createConversation(client, wallet, title, agentId),
    getConversation: (id, wallet) => redisStore.getConversation(client, id, wallet),
    renameConversation: (id, wallet, title) => redisStore.renameConversation(client, id, wallet, title),
    archiveConversation: (id, wallet) => redisStore.archiveConversation(client, id, wallet),
    pinConversation: (id, wallet, pinned) => redisStore.pinConversation(client, id, wallet, pinned),
    listMessages: (conversationId) => redisStore.listMessages(client, conversationId),
    appendMessage: (conversationId, msg) => redisStore.appendMessage(client, conversationId, msg),
    updateConversationState: (conversationId, state, agentId) =>
      redisStore.updateConversationState(client, conversationId, state, agentId),
    recordActivity: (wallet, kind, title, meta, explorerUrl, refId) =>
      redisStore.recordActivity(client, wallet, kind, title, meta ?? {}, explorerUrl, refId),
    listActivity: (wallet) => redisStore.listActivity(client, wallet),
  };
}

async function tryPostgres(env: BeaconEnv): Promise<FlowHistory | null> {
  const url = env.DATABASE_URL_DIRECT || env.DATABASE_URL;
  if (!url) return null;
  const pool = new Pool({
    connectionString: url,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 4000,
  });
  try {
    await pool.query("select 1");
    await pgStore.ensureFlowSchema(pool);
    return wrapPostgres(pool);
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
}

async function tryRedis(env: BeaconEnv): Promise<FlowHistory | null> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  const client: RedisRest = {
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  };
  try {
    const ok = await redisStore.pingRedis(client);
    return ok ? wrapRedis(client) : null;
  } catch {
    return null;
  }
}

/** Postgres first if it actually answers. Otherwise durable Upstash Redis. Never in-memory. */
export async function openFlowHistory(env: BeaconEnv): Promise<FlowHistory | null> {
  const pg = await tryPostgres(env);
  if (pg) return pg;
  return tryRedis(env);
}
