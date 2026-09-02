import { describe, expect, it } from "vitest";
import { destinationComplete, extractBridgeFromChainId, extractBridgeToChainId, extractBridgeTxHash, parseBridgeIntent, quoteLifiBridge, statusLifiBridge } from "./lifiBridge.js";

describe("parseBridgeIntent", () => {
  it("parses Base USDC → 0G", () => {
    const p = parseBridgeIntent("Bridge 1 USDC from Base to 0G");
    expect(p?.sourceChainId).toBe(8453);
    expect(p?.destChainId).toBe(16661);
    expect(p?.supported).toBe(true);
    expect(p?.amountAtomic).toBe("1000000");
    expect(p?.fromToken.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("parses 0G → USDC on Base and does not reverse", () => {
    for (const text of [
      "Bridge 0.3 0G to USDC on Base",
      "Bridge 0.3 0G to USDC from Base",
    ]) {
      const p = parseBridgeIntent(text);
      expect(p?.sourceChainId).toBe(16661);
      expect(p?.destChainId).toBe(8453);
      expect(p?.fromSymbol).toBe("0G");
      expect(p?.toSymbol).toBe("USDC");
      expect(p?.supported).toBe(true);
      expect(p?.amountAtomic).toBe("300000000000000000");
    }
  });

  it("does not treat a how-to as a quote", () => {
    expect(parseBridgeIntent("How do I bridge to 0G?")).toBeNull();
  });

  it("rejects an unsupported reverse without inventing Base → 0G", () => {
    const p = parseBridgeIntent("Bridge 1 USDC.e from 0G to Solana");
    expect(p?.supported).toBe(false);
    expect(p?.unsupportedReason).toMatch(/not currently supported/i);
  });

  it("rejects a wrong-chain request without reversing", () => {
    const p = parseBridgeIntent("Bridge 1 USDC from Solana to 0G");
    expect(p?.supported).toBe(false);
    expect(p?.sourceChainId).not.toBe(8453);
  });
});

describe("quoteLifiBridge", () => {
  it("retries once when LI.FI first fails", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: "temporarily unavailable" }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          id: "quote-2",
          tool: "stargateV2",
          estimate: { toAmount: "9543", toAmountMin: "9400", executionDuration: 103 },
          action: { fromToken: { symbol: "USDC" }, toToken: { symbol: "USDC.e" } },
          transactionRequest: {
            to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
            data: "0xabc",
            value: "0x0",
            chainId: 8453,
          },
        }),
      } as Response;
    }) as typeof fetch;
    const intent = parseBridgeIntent("Bridge 1 USDC from Base to 0G")!;
    const card = await quoteLifiBridge(intent, "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf", fetchImpl);
    expect(n).toBe(2);
    expect(card.executableFromUserWallet).toBe(true);
  });

  it("maps a live-shaped LI.FI quote and never marks complete", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          id: "quote-1",
          tool: "stargateV2",
          estimate: {
            toAmount: "9543",
            toAmountMin: "9400",
            executionDuration: 103,
            approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
          },
          action: { fromToken: { symbol: "USDC" }, toToken: { symbol: "USDC.e" } },
          transactionRequest: {
            to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
            data: "0xabc",
            value: "0x0",
            chainId: 8453,
          },
        }),
      }) as Response) as typeof fetch;
    const intent = parseBridgeIntent("Bridge 1 USDC from Base to 0G")!;
    const card = await quoteLifiBridge(intent, "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf", fetchImpl);
    expect(card.executableFromBeaconSafe).toBe(false);
    expect(card.executableFromUserWallet).toBe(true);
    expect(card.transactionRequest?.chainId).toBe(8453);
    expect(card.fromChainId).toBe(8453);
    expect(card.toChainId).toBe(16661);
    expect(card.title).toMatch(/Base →/);
    expect(card.title).not.toMatch(/0G Aristotle →/);
    expect(card.estimatedOut).toBe("0.009543");
    expect(card.quotedAt).toMatch(/^\d{4}-/);
  });

  it("quotes 0G → Base from the parsed direction", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      expect(href).toMatch(/fromChain=16661/);
      expect(href).toMatch(/toChain=8453/);
      expect(href).not.toMatch(/fromChain=8453/);
      return {
        ok: true,
        json: async () => ({
          id: "out-1",
          tool: "stargateV2",
          estimate: { toAmount: "49945", toAmountMin: "49695", executionDuration: 2 },
          action: {
            fromToken: { symbol: "0G", decimals: 18 },
            toToken: { symbol: "USDC", decimals: 6 },
          },
          transactionRequest: {
            to: "0x213A83c67E1Fc0334eF684571ABCB820708A6536",
            data: "0xabc",
            value: "0x42bb14c1e5d60000",
            chainId: 16661,
          },
        }),
      } as Response;
    }) as typeof fetch;
    const intent = parseBridgeIntent("Bridge 0.3 0G to USDC on Base")!;
    const card = await quoteLifiBridge(intent, "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf", fetchImpl);
    expect(card.fromChainId).toBe(16661);
    expect(card.toChainId).toBe(8453);
    expect(card.title).toMatch(/0G Aristotle →/);
    expect(card.title).not.toMatch(/USDC Base →/);
    expect(card.estimatedOut).toBe("0.049945");
    expect(card.executionMode).toBe("WALLET_EXECUTABLE");
    expect(card.executableFromBeaconSafe).toBe(false);
  });

  it("throws UNSUPPORTED_ROUTE instead of reversing", async () => {
    const intent = parseBridgeIntent("Bridge 1 USDC from Solana to 0G")!;
    await expect(
      quoteLifiBridge(intent, "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf", async () => {
        throw new Error("LI.FI should not be called");
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ROUTE" });
  });
});

describe("statusLifiBridge", () => {
  it("does not mark complete without a destination tx", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({ status: "PENDING", sending: { txHash: "0xsrc" } }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge("0xsrc", 8453, fetchImpl);
    expect(st.complete).toBe(false);
    expect(st.status).toBe("PENDING");
  });

  it("does not mark PENDING as complete", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({ status: "PENDING", sending: { txHash: "0xsrc" }, receiving: { txHash: "0xother" } }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge("0xsrc", 8453, fetchImpl);
    expect(st.complete).toBe(false);
  });

  it("does not mark FAILED as complete", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          status: "FAILED",
          sending: { txHash: "0xsrc" },
          receiving: { txHash: "0xdst" },
        }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge("0xsrc", 8453, fetchImpl);
    expect(st.complete).toBe(false);
  });

  it("marks complete only when DONE and a destination tx exist", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          status: "DONE",
          sending: { txHash: "0xsrc" },
          receiving: { txHash: "0xdst" },
        }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge("0xsrc", 8453, fetchImpl);
    expect(st.complete).toBe(true);
    expect(st.receivingTx).toBe("0xdst");
  });

  it("does not mark DONE complete without a destination tx", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({ status: "DONE", sending: { txHash: "0xsrc" } }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge("0xsrc", 8453, fetchImpl);
    expect(st.complete).toBe(false);
  });

  it("does not mark complete when LI.FI reports a different source hash", async () => {
    const queried = "0x" + "00".repeat(31) + "01";
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => ({
          status: "DONE",
          sending: { txHash: "0xe4132a8d" + "ab".repeat(28) },
          receiving: { txHash: "0xe4132a8d" + "ab".repeat(28) },
        }),
      }) as Response) as typeof fetch;
    const st = await statusLifiBridge(queried, 8453, fetchImpl);
    expect(st.complete).toBe(false);
    expect(st.status).toBe("NOT_FOUND");
    expect(st.receivingTx).toBeNull();
    expect(st.honesty).toMatch(/did not confirm this source hash/i);
  });
});

describe("destinationComplete", () => {
  it("requires DONE complete plus a destination hash", () => {
    expect(destinationComplete({ complete: true, receivingTx: "0xdst" })).toBe(true);
    expect(destinationComplete({ complete: true, receivingTx: null })).toBe(false);
    expect(destinationComplete({ complete: false, receivingTx: "0xdst" })).toBe(false);
  });
});

describe("extractBridgeTxHash", () => {
  const hash = "0x" + "ab".repeat(32);
  it("reads txHash or a hash embedded in text", () => {
    expect(extractBridgeTxHash({ txHash: hash })).toBe(hash);
    expect(extractBridgeTxHash({ text: `status ${hash} from Base` })).toBe(hash);
    expect(extractBridgeTxHash({ text: "Bridge 1 USDC from Base to 0G" })).toBeNull();
  });
  it("defaults fromChainId to Base unless Ethereum or 0G is named", () => {
    expect(extractBridgeFromChainId({ fromChainId: 1 })).toBe(1);
    expect(extractBridgeFromChainId({ fromChainId: 16661 })).toBe(16661);
    expect(extractBridgeFromChainId({ text: "ethereum" })).toBe(1);
    expect(extractBridgeFromChainId({ text: "from 0G to Base" })).toBe(16661);
    expect(extractBridgeFromChainId({ text: "Bridge 0.3 0G to USDC on Base" })).toBe(16661);
    expect(extractBridgeFromChainId({ text: "Bridge 1 USDC from Base to 0G" })).toBe(8453);
    expect(extractBridgeFromChainId({ text: "Base" })).toBe(8453);
    expect(extractBridgeToChainId({ text: "Bridge 0.3 0G to USDC on Base" }, 16661)).toBe(8453);
    expect(extractBridgeToChainId({ text: "Bridge 1 USDC from Base to 0G" }, 8453)).toBe(16661);
  });
});
