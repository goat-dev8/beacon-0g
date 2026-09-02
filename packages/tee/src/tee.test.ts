import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { loadEnv } from "@beacon/shared";
import { recoverTeeSigner, verifyEip191 } from "./eip191.js";
import { reviewIntent } from "./reviewIntent.js";
import type { ComputeBroker } from "@beacon/compute";

describe("eip191", () => {
  it("recovers the signing address", async () => {
    const wallet = Wallet.createRandom();
    const message = "beacon-tee-proof";
    const sig = await wallet.signMessage(message);
    expect(recoverTeeSigner(message, sig).toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(verifyEip191(message, sig, wallet.address)).toBe(true);
    expect(verifyEip191(message, sig, Wallet.createRandom().address)).toBe(false);
  });
});

describe("reviewIntent", () => {
  const env = loadEnv({ COMPUTE_API_KEY: "sk-test", ZEROG_ROUTER_URL: "https://router-api.0g.ai" });

  it("DENY when ZG-Res-Key is missing", async () => {
    const decision = await reviewIntent(
      {
        userText: "swap 2 0G",
        tool: "swap",
        amount0g: "2",
        target: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30",
        model: "glm-5.2",
      },
      {
        env,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "",
              choices: [{ message: { content: '{"allow":true,"reason":"ok","category":"swap"}' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toMatch(/ZG-Res-Key|chatID/);
  });

  it("DENY when processResponse is not true", async () => {
    const broker: ComputeBroker = {
      ledger: {
        getLedger: async () => ({ availableBalance: 0n, totalBalance: 0n }),
        depositFund: async () => undefined,
      },
      inference: {
        processResponse: async () => false,
      },
    };
    const decision = await reviewIntent(
      {
        userText: "swap 2 0G",
        tool: "swap",
        amount0g: "2",
        target: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30",
        model: "glm-5.2",
      },
      {
        env,
        broker,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "cmpl",
              choices: [{ message: { content: '{"allow":true,"reason":"ok","category":"swap"}' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "ZG-Res-Key": "chat-1",
                "X-0G-Provider-Address": "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D",
              },
            },
          ),
      },
    );
    expect(decision.allow).toBe(false);
    expect(decision.processResponse).toBe(false);
  });

  it("asks TeeML to ALLOW catalog escrow jobs", async () => {
    let body = "";
    await reviewIntent(
      {
        userText: "Research 0G Storage proofs and quote a cheap job.",
        tool: "cheap",
        amount0g: "0.001",
        target: "0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566",
        model: "glm-5.2",
      },
      {
        env,
        fetchImpl: async (_url, init) => {
          body = String(init?.body ?? "");
          return new Response(JSON.stringify({ id: "", choices: [{ message: { content: "{}" } }] }), {
            status: 200,
          });
        },
      },
    );
    expect(body).toMatch(/ALLOW catalog jobs/);
    expect(body).toMatch(/catalogJob/);
  });

  it("ALLOW only when processResponse is true", async () => {
    const broker: ComputeBroker = {
      ledger: {
        getLedger: async () => ({ availableBalance: 0n, totalBalance: 0n }),
        depositFund: async () => undefined,
      },
      inference: {
        processResponse: async () => true,
      },
    };
    const decision = await reviewIntent(
      {
        userText: "write a summary",
        tool: "infer",
        amount0g: "0.01",
        target: "0x47340d900bdFec2BD393c626E12ea0656F938d84",
        model: "glm-5.2",
      },
      {
        env,
        broker,
        independentProof: async () => ({
          processResponse: true,
          eip191Ok: true,
          recoveredSigner: "0x1111111111111111111111111111111111111111",
          expectedSigner: "0x1111111111111111111111111111111111111111",
          signedTextHash: "ok",
          signatureUrl: "https://provider.example/v1/proxy/signature/chat-ok",
        }),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "cmpl",
              choices: [{ message: { content: '{"allow":true,"reason":"ok","category":"infer"}' } }],
              usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "ZG-Res-Key": "chat-ok",
                "X-0G-Provider-Address": "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D",
              },
            },
          ),
      },
    );
    expect(decision.allow).toBe(true);
    expect(decision.processResponse).toBe(true);
    expect(decision.eip191Ok).toBe(true);
    expect(decision.zgResKey).toBe("chat-ok");
  });

  it("DENY when independent EIP-191 does not match", async () => {
    const broker: ComputeBroker = {
      ledger: {
        getLedger: async () => ({ availableBalance: 0n, totalBalance: 0n }),
        depositFund: async () => undefined,
      },
      inference: {
        processResponse: async () => true,
      },
    };
    const decision = await reviewIntent(
      {
        userText: "write a summary",
        tool: "infer",
        amount0g: "0.01",
        target: "0x47340d900bdFec2BD393c626E12ea0656F938d84",
        model: "glm-5.2",
      },
      {
        env,
        broker,
        independentProof: async () => ({
          processResponse: true,
          eip191Ok: false,
          recoveredSigner: "0x2222222222222222222222222222222222222222",
          expectedSigner: "0x1111111111111111111111111111111111111111",
          signedTextHash: "mismatch",
          signatureUrl: "https://provider.example/v1/proxy/signature/chat-ok",
        }),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "cmpl",
              choices: [{ message: { content: '{"allow":true,"reason":"ok","category":"infer"}' } }],
              usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "ZG-Res-Key": "chat-ok",
                "X-0G-Provider-Address": "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D",
              },
            },
          ),
      },
    );
    expect(decision.allow).toBe(false);
    expect(decision.eip191Ok).toBe(false);
    expect(decision.category).toBe("signer_mismatch");
  });
});
