import { describe, expect, it } from "vitest";
import {
  SELECTOR_ERC20_APPROVE,
  SELECTOR_EXACT_INPUT_SINGLE,
  SELECTOR_WETH_DEPOSIT,
  preflightVaultCalls,
} from "./preflight.js";

const SAFE = "0x6a3388d833c09a00ddbbd4e1a6c11c9623717a30";
const W0G = "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c";
const ROUTER = "0x18cca38e51c4c339a6bd6e174025f08360feef30";
const STRANGER = "0x1111111111111111111111111111111111111111";

function padded(addr: string): string {
  return addr.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

const wrapCall = {
  target: W0G,
  data: `${SELECTOR_WETH_DEPOSIT}${"00".repeat(32)}`,
  value: 10n ** 17n,
  maxSpend: 0n,
};
const approveCall = {
  target: W0G,
  data: `${SELECTOR_ERC20_APPROVE}${padded(ROUTER)}${"00".repeat(32)}`,
  value: 0n,
  maxSpend: 0n,
};
const swapCall = {
  target: ROUTER,
  data: `${SELECTOR_EXACT_INPUT_SINGLE}${"00".repeat(32)}${padded(SAFE)}${"11".repeat(16)}`,
  value: 0n,
  maxSpend: 10n ** 17n,
};

const base = {
  safe: SAFE,
  paused: false,
  maxSpendPolicyWei: 5n * 10n ** 18n,
  allowedTargets: [W0G, ROUTER],
  w0g: W0G,
  router: ROUTER,
  quotedMinOut: 1n,
  deadlineSeconds: Math.floor(Date.now() / 1000) + 600,
};

describe("preflightVaultCalls", () => {
  it("ALLOWs wrap + approve + exactInputSingle to the Safe", () => {
    const d = preflightVaultCalls({ ...base, calls: [wrapCall, approveCall, swapCall] });
    expect(d.verdict).toBe("ALLOW");
    expect(d.intentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("DENYs an arbitrary target", () => {
    const d = preflightVaultCalls({
      ...base,
      calls: [{ ...swapCall, target: STRANGER }],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/target/i);
  });

  it("DENYs an arbitrary selector", () => {
    const d = preflightVaultCalls({
      ...base,
      calls: [{ ...swapCall, data: "0xa9059cbb" + padded(STRANGER) + "00".repeat(32) }],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/selector/i);
  });

  it("DENYs a paused Safe", () => {
    const d = preflightVaultCalls({
      ...base,
      paused: true,
      calls: [wrapCall, approveCall, swapCall],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/paused/i);
  });

  it("DENYs spend above policy", () => {
    const d = preflightVaultCalls({
      ...base,
      maxSpendPolicyWei: 1n,
      calls: [swapCall],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/maxSpend/i);
  });

  it("DENYs a swap whose recipient is not the Safe", () => {
    const d = preflightVaultCalls({
      ...base,
      calls: [
        {
          ...swapCall,
          data: `${SELECTOR_EXACT_INPUT_SINGLE}${"00".repeat(32)}${padded(STRANGER)}`,
        },
      ],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/destination/i);
  });

  it("DENYs a stale deadline", () => {
    const d = preflightVaultCalls({
      ...base,
      deadlineSeconds: 1,
      nowSeconds: 100,
      calls: [swapCall],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/deadline/i);
  });

  it("DENYs a replayed nonce", () => {
    const d = preflightVaultCalls({
      ...base,
      nonce: 7n,
      seenNonces: ["7"],
      calls: [swapCall],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/nonce/i);
  });

  it("DENYs zero minOut", () => {
    const d = preflightVaultCalls({
      ...base,
      quotedMinOut: 0n,
      calls: [swapCall],
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/minOut/i);
  });

  it("DENYs a failed chain simulation even when the envelope is well-formed", () => {
    const d = preflightVaultCalls({
      ...base,
      calls: [wrapCall, approveCall, swapCall],
      simulationOk: false,
      simulationDetail: "eth_call reverted: insufficient wealth",
    });
    expect(d.verdict).toBe("DENY");
    expect(d.reason).toMatch(/simulation/);
  });
});
