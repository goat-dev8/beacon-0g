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
    ssl: env.DATABASE_SSL || /supabase\.com|:6543\b/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 8000,
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

export function redisClientFromEnv(env: BeaconEnv): RedisRest | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
}

async function tryRedis(env: BeaconEnv): Promise<FlowHistory | null> {
  const client = redisClientFromEnv(env);
  if (!client) return null;
  try {
    const ok = await redisStore.pingRedis(client);
    return ok ? wrapRedis(client) : null;
  } catch {
    return null;
  }
}

function wrapLayered(primary: FlowHistory, fallback: FlowHistory): FlowHistory {
  return {
    kind: primary.kind,
    listConversations: async (wallet) => {
      const rows = await primary.listConversations(wallet);
      if (rows.length > 0) return rows;
      return fallback.listConversations(wallet);
    },
    createConversation: (wallet, title, agentId) => primary.createConversation(wallet, title, agentId),
    getConversation: async (id, wallet) => {
      return (await primary.getConversation(id, wallet)) ?? fallback.getConversation(id, wallet);
    },
    renameConversation: (id, wallet, title) => primary.renameConversation(id, wallet, title),
    archiveConversation: (id, wallet) => primary.archiveConversation(id, wallet),
    pinConversation: (id, wallet, pinned) => primary.pinConversation(id, wallet, pinned),
    listMessages: async (conversationId) => {
      const rows = await primary.listMessages(conversationId);
      if (rows.length > 0) return rows;
      return fallback.listMessages(conversationId);
    },
    appendMessage: (conversationId, msg) => primary.appendMessage(conversationId, msg),
    updateConversationState: (conversationId, state, agentId) =>
      primary.updateConversationState(conversationId, state, agentId),
    recordActivity: (wallet, kind, title, meta, explorerUrl, refId) =>
      primary.recordActivity(wallet, kind, title, meta, explorerUrl, refId),
    listActivity: async (wallet) => {
      const rows = await primary.listActivity(wallet);
      if (rows.length > 0) return rows;
      return fallback.listActivity(wallet);
    },
  };
}

/** Postgres first if it actually answers. Redis remains readable so a new database does not hide prior chats. Never in-memory. */
export async function openFlowHistory(env: BeaconEnv): Promise<FlowHistory | null> {
  const pg = await tryPostgres(env);
  const redis = await tryRedis(env);
  if (pg && redis) return wrapLayered(pg, redis);
  return pg ?? redis;
}
