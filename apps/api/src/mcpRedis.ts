import { redisCmd, type RedisRest } from "./flowRedis.js";
import type { RedisLike } from "@beacon/mcp";

export function redisLikeFromRest(client: RedisRest): RedisLike {
  return {
    get: async <T = unknown>(key: string) => {
      const raw = await redisCmd(client, ["GET", key]);
      if (raw == null) return null;
      if (typeof raw !== "string") return raw as T;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },
    set: async (key, value, opts) => {
      const payload = typeof value === "string" ? value : JSON.stringify(value);
      if (opts?.ex) {
        await redisCmd(client, ["SET", key, payload, "EX", String(opts.ex)]);
      } else {
        await redisCmd(client, ["SET", key, payload]);
      }
    },
    del: async (...keys) => {
      for (const key of keys) await redisCmd(client, ["DEL", key]);
    },
    lpush: async (key, ...values) => {
      for (const value of values) await redisCmd(client, ["LPUSH", key, value]);
    },
    ltrim: async (key, start, stop) => {
      await redisCmd(client, ["LTRIM", key, start, stop]);
    },
    lrange: async (key, start, stop) => {
      const raw = await redisCmd(client, ["LRANGE", key, start, stop]);
      return Array.isArray(raw) ? raw.map(String) : [];
    },
    sadd: async (key, ...members) => {
      if (members.length === 0) return;
      await redisCmd(client, ["SADD", key, ...members]);
    },
    smembers: async (key) => {
      const raw = await redisCmd(client, ["SMEMBERS", key]);
      return Array.isArray(raw) ? raw.map(String) : [];
    },
    srem: async (key, ...members) => {
      if (members.length === 0) return;
      await redisCmd(client, ["SREM", key, ...members]);
    },
    incr: async (key) => Number(await redisCmd(client, ["INCR", key]) ?? 0),
    expire: async (key, seconds) => {
      await redisCmd(client, ["EXPIRE", key, seconds]);
    },
  };
}
