import { describe, expect, it } from "vitest";
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
} from "./flowRedis.js";
import type { RedisRest } from "./flowRedis.js";

class MemoryRedis {
  lists = new Map<string, string[]>();
  kv = new Map<string, string>();
  z = new Map<string, Map<string, number>>();

  async fetch(_url: string, init?: RequestInit): Promise<Response> {
    const args = JSON.parse(String(init?.body ?? "[]")) as Array<string | number>;
    const cmd = String(args[0]).toUpperCase();
    let result: unknown = null;
    if (cmd === "PING") result = "PONG";
    else if (cmd === "GET") result = this.kv.get(String(args[1])) ?? null;
    else if (cmd === "SET") {
      this.kv.set(String(args[1]), String(args[2]));
      result = "OK";
    } else if (cmd === "RPUSH") {
      const list = this.lists.get(String(args[1])) ?? [];
      list.push(String(args[2]));
      this.lists.set(String(args[1]), list);
      result = list.length;
    } else if (cmd === "LRANGE") {
      const list = this.lists.get(String(args[1])) ?? [];
      result = list.slice(Number(args[2]), Number(args[3]) + 1);
    } else if (cmd === "LINDEX") {
      const list = this.lists.get(String(args[1])) ?? [];
      const idx = Number(args[2]);
      result = idx < 0 ? list[list.length + idx] ?? null : list[idx] ?? null;
    } else if (cmd === "ZADD") {
      const z = this.z.get(String(args[1])) ?? new Map();
      z.set(String(args[3]), Number(args[2]));
      this.z.set(String(args[1]), z);
      result = 1;
    } else if (cmd === "ZREVRANGE") {
      const z = this.z.get(String(args[1])) ?? new Map();
      result = [...z.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(Number(args[2]), Number(args[3]) + 1)
        .map(([id]) => id);
    } else if (cmd === "LPUSH") {
      const list = this.lists.get(String(args[1])) ?? [];
      list.unshift(String(args[2]));
      this.lists.set(String(args[1]), list);
      result = list.length;
    } else if (cmd === "LTRIM") {
      const list = (this.lists.get(String(args[1])) ?? []).slice(Number(args[2]), Number(args[3]) + 1);
      this.lists.set(String(args[1]), list);
      result = "OK";
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
}

describe("flow redis history", () => {
  it("persists a conversation per wallet and refuses cross-wallet reads", async () => {
    const memory = new MemoryRedis();
    const client: RedisRest = {
      url: "https://example.upstash.io",
      token: "test",
      fetchImpl: memory.fetch.bind(memory) as typeof fetch,
    };
    const a = "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf";
    const b = "0x000000000000000000000000000000000000dEaD";
    const created = await createConversation(client, a, "Convert 0.01 0G to USDC", "general");
    await appendMessage(client, created.id, { role: "user", text: "Convert 0.01 0G to USDC" });
    await appendMessage(client, created.id, { role: "assistant", text: "Zia quote" });
    const mine = await listConversations(client, a);
    const theirs = await listConversations(client, b);
    expect(mine).toHaveLength(1);
    expect(mine[0].last_message).toBe("Zia quote");
    expect(theirs).toHaveLength(0);
    expect(await getConversation(client, created.id, b)).toBeNull();
    const msgs = await listMessages(client, created.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
