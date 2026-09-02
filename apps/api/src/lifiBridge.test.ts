import { describe, expect, it } from "vitest";
import { parseBridgeIntent, quoteLifiBridge, statusLifiBridge } from "./lifiBridge.js";

describe("parseBridgeIntent", () => {
  it("parses Base USDC → 0G", () => {
    const p = parseBridgeIntent("Bridge 1 USDC from Base to 0G");
    expect(p?.sourceChainId).toBe(8453);
    expect(p?.amountAtomic).toBe("1000000");
    expect(p?.fromToken.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("returns null without a source chain", () => {
    expect(parseBridgeIntent("How do I bridge to 0G?")).toBeNull();
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
          json: async () => ({ message: "None of the available routes could successfully generate a tx" }),
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
    expect(card.estimatedOut).toBe("0.009543");
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
});
