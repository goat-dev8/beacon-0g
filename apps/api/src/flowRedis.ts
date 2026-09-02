import { randomUUID } from "node:crypto";

export type RedisRest = {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export type ConversationRow = {
  id: string;
  wallet: string;
  title: string;
  agent_id: string;
  pinned: boolean;
  archived: boolean;
  state_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
  last_cards?: unknown[] | null;
};

export type MessageRow = {
  id: string;
  role: string;
  agent_id: string | null;
  text: string;
  cards_json: unknown[];
  display_model: string | null;
  created_at: string;
};

export type ActivityRow = {
  id: string;
  kind: string;
  title: string;
  meta: Record<string, unknown>;
  explorer_url: string | null;
  ref_id: string | null;
  created_at: string;
};

function convKey(id: string) {
  return `flow:c:${id}`;
}
function msgKey(id: string) {
  return `flow:c:${id}:msgs`;
}
function walletKey(wallet: string) {
  return `flow:w:${wallet.toLowerCase()}:convs`;
}
function activityKey(wallet: string) {
  return `flow:w:${wallet.toLowerCase()}:activity`;
}

export async function redisCmd(client: RedisRest, args: Array<string | number>): Promise<unknown> {
  const fetchImpl = client.fetchImpl ?? fetch;
  const res = await fetchImpl(client.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || json.error) {
    throw new Error(json.error || `redis ${res.status}`);
  }
  return json.result;
}

async function loadConv(client: RedisRest, id: string): Promise<ConversationRow | null> {
  const raw = await redisCmd(client, ["GET", convKey(id)]);
  if (!raw || typeof raw !== "string") return null;
  return JSON.parse(raw) as ConversationRow;
}

async function saveConv(client: RedisRest, row: ConversationRow): Promise<void> {
  await redisCmd(client, ["SET", convKey(row.id), JSON.stringify(row)]);
  const score = Date.parse(row.updated_at) || Date.now();
  await redisCmd(client, ["ZADD", walletKey(row.wallet), score, row.id]);
}

export async function pingRedis(client: RedisRest): Promise<boolean> {
  const result = await redisCmd(client, ["PING"]);
  return result === "PONG" || result === true;
}

export async function listConversations(client: RedisRest, wallet: string): Promise<ConversationRow[]> {
  const ids = (await redisCmd(client, ["ZREVRANGE", walletKey(wallet), 0, 49])) as string[] | null;
  const out: ConversationRow[] = [];
  for (const id of ids ?? []) {
    const row = await loadConv(client, String(id));
    if (!row || row.archived) continue;
    if (row.wallet.toLowerCase() !== wallet.toLowerCase()) continue;
    const last = (await redisCmd(client, ["LINDEX", msgKey(row.id), -1])) as string | null;
    const lastMsg = last ? (JSON.parse(last) as MessageRow) : null;
    out.push({
      ...row,
      last_message: lastMsg?.text ?? null,
      last_cards: lastMsg?.cards_json ?? null,
    });
  }
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export async function createConversation(
  client: RedisRest,
  wallet: string,
  title = "New chat",
  agentId = "general",
): Promise<ConversationRow> {
  const now = new Date().toISOString();
  const row: ConversationRow = {
    id: randomUUID(),
    wallet,
    title,
    agent_id: agentId,
    pinned: false,
    archived: false,
    state_json: {},
    created_at: now,
    updated_at: now,
  };
  await saveConv(client, row);
  return row;
}

export async function getConversation(
  client: RedisRest,
  id: string,
  wallet: string,
): Promise<ConversationRow | null> {
  const row = await loadConv(client, id);
  if (!row || row.archived || row.wallet.toLowerCase() !== wallet.toLowerCase()) return null;
  return row;
}

export async function renameConversation(client: RedisRest, id: string, wallet: string, title: string) {
  const row = await getConversation(client, id, wallet);
  if (!row) return;
  row.title = title.slice(0, 120);
  row.updated_at = new Date().toISOString();
  await saveConv(client, row);
}

export async function archiveConversation(client: RedisRest, id: string, wallet: string) {
  const row = await getConversation(client, id, wallet);
  if (!row) return;
  row.archived = true;
  row.updated_at = new Date().toISOString();
  await saveConv(client, row);
}

export async function pinConversation(client: RedisRest, id: string, wallet: string, pinned: boolean) {
  const row = await getConversation(client, id, wallet);
  if (!row) return;
  row.pinned = pinned;
  row.updated_at = new Date().toISOString();
  await saveConv(client, row);
}

export async function listMessages(client: RedisRest, conversationId: string): Promise<MessageRow[]> {
  const raw = (await redisCmd(client, ["LRANGE", msgKey(conversationId), 0, 199])) as string[] | null;
  return (raw ?? []).map((item) => JSON.parse(item) as MessageRow);
}

export async function appendMessage(
  client: RedisRest,
  conversationId: string,
  msg: {
    role: string;
    agentId?: string;
    text: string;
    cards?: unknown[];
    displayModel?: string;
  },
) {
  const row: MessageRow = {
    id: randomUUID(),
    role: msg.role,
    agent_id: msg.agentId ?? null,
    text: msg.text,
    cards_json: msg.cards ?? [],
    display_model: msg.displayModel ?? null,
    created_at: new Date().toISOString(),
  };
  await redisCmd(client, ["RPUSH", msgKey(conversationId), JSON.stringify(row)]);
  const conv = await loadConv(client, conversationId);
  if (conv) {
    conv.updated_at = row.created_at;
    await saveConv(client, conv);
  }
  return { id: row.id, created_at: row.created_at };
}

export async function updateConversationState(
  client: RedisRest,
  conversationId: string,
  state: unknown,
  agentId?: string,
) {
  const conv = await loadConv(client, conversationId);
  if (!conv) return;
  conv.state_json = (state ?? {}) as Record<string, unknown>;
  if (agentId) conv.agent_id = agentId;
  conv.updated_at = new Date().toISOString();
  await saveConv(client, conv);
}

export async function recordActivity(
  client: RedisRest,
  wallet: string,
  kind: string,
  title: string,
  meta: Record<string, unknown> = {},
  explorerUrl?: string,
  refId?: string,
) {
  const row: ActivityRow = {
    id: randomUUID(),
    kind,
    title,
    meta,
    explorer_url: explorerUrl ?? null,
    ref_id: refId ?? null,
    created_at: new Date().toISOString(),
  };
  await redisCmd(client, ["LPUSH", activityKey(wallet), JSON.stringify(row)]);
  await redisCmd(client, ["LTRIM", activityKey(wallet), 0, 39]);
}

export async function listActivity(client: RedisRest, wallet: string): Promise<ActivityRow[]> {
  const raw = (await redisCmd(client, ["LRANGE", activityKey(wallet), 0, 39])) as string[] | null;
  return (raw ?? []).map((item) => JSON.parse(item) as ActivityRow);
}
