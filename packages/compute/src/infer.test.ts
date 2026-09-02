import { describe, expect, it } from "vitest";
import { loadEnv } from "@beacon/shared";
import { chatCompletions, hashRouterTraceClaim } from "./infer.js";

describe("chatCompletions router client", () => {
  it("sends trust-mode header and reads ZG-Res-Key", async () => {
    const env = loadEnv({
      COMPUTE_API_KEY: "sk-test",
      ZEROG_ROUTER_URL: "https://router-api.0g.ai",
    });
    let captured: RequestInit | undefined;
    const result = await chatCompletions(
      {
        model: "glm-5.2",
        messages: [{ role: "user", content: "ping" }],
        trustMode: "private",
      },
      {
        env,
        fetchImpl: async (_url, init) => {
          captured = init;
          return new Response(
            JSON.stringify({
              id: "chatcmpl-1",
              model: "glm-5.2",
              choices: [{ message: { role: "assistant", content: "{\"ok\":true}" } }],
              usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "ZG-Res-Key": "chat-key-1",
                "X-0G-Provider-Address": "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D",
              },
            },
          );
        },
      },
    );
    const headers = new Headers(captured?.headers);
    expect(headers.get("X-0G-Provider-Trust-Mode")).toBe("private");
    expect(headers.get("X-0G-Provider-Allow-Fallbacks")).toBe("false");
    expect(result.zgResKey).toBe("chat-key-1");
    expect(result.chatId).toBe("chat-key-1");
    expect(result.usage.promptTokens).toBe(10);
  });

  it("extracts x_0g_trace and hashes the Router-reported claim", async () => {
    const env = loadEnv({
      COMPUTE_API_KEY: "sk-test",
      ZEROG_ROUTER_URL: "https://router-api.0g.ai",
    });
    const provider = "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D";
    const result = await chatCompletions(
      {
        model: "glm-5.2",
        messages: [{ role: "user", content: "ping" }],
        trustMode: "private",
      },
      {
        env,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "req-trace-1",
              model: "glm-5.2",
              choices: [{ message: { role: "assistant", content: "ok" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              x_0g_trace: { request_id: "req-trace-1", provider, tee_verified: true },
            }),
            { status: 200, headers: { "content-type": "application/json", "ZG-Res-Key": "k" } },
          ),
      },
    );
    expect(result.routerTrace?.requestId).toBe("req-trace-1");
    expect(result.routerTrace?.provider).toBe(provider);
    expect(result.routerTrace?.teeVerified).toBe(true);
    expect(hashRouterTraceClaim(result.routerTrace)).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("fails closed without COMPUTE_API_KEY", async () => {
    const env = loadEnv({ COMPUTE_API_KEY: "" });
    await expect(
      chatCompletions(
        { model: "glm-5.2", messages: [{ role: "user", content: "x" }], trustMode: "private" },
        { env, fetchImpl: async () => new Response("no", { status: 500 }) },
      ),
    ).rejects.toThrow(/COMPUTE_API_KEY/);
  });
});
