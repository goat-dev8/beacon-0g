import { describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { simulateVaultCalls } from "./simulateVault.js";

const ABI = new Interface([
  "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce, uint256 value) returns (bytes)",
]);

describe("simulateVaultCalls", () => {
  it("ALLOWs when every eth_call succeeds", async () => {
    const call = vi.fn(async () => "0x");
    const d = await simulateVaultCalls({
      call,
      vaultAbi: ABI,
      safe: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30",
      executor: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
      nonce: 1n,
      calls: [{ target: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c", data: "0xd0e30db0", value: 1n, maxSpend: 0n }],
    });
    expect(d.ok).toBe(true);
    expect(call).toHaveBeenCalledOnce();
  });

  it("DENYs when an independent eth_call reverts", async () => {
    const d = await simulateVaultCalls({
      call: async () => {
        throw new Error("execution reverted: paused");
      },
      vaultAbi: ABI,
      safe: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30",
      executor: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
      nonce: 1n,
      calls: [{ target: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c", data: "0xd0e30db0" }],
    });
    expect(d.ok).toBe(false);
    expect(d.detail).toMatch(/paused/);
  });

  it("does not DENY a swap eth_call that depends on a prior wrap in the same bundle", async () => {
    const wrap = "0xd0e30db0" + "00".repeat(32);
    const approve = "0x095ea7b3" + "00".repeat(64);
    const swap = "0x414bf389" + "00".repeat(64);
    let n = 0;
    const d = await simulateVaultCalls({
      call: async () => {
        n += 1;
        if (n === 3) throw new Error("execution reverted: call failed");
        return "0x";
      },
      vaultAbi: ABI,
      safe: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30",
      executor: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
      nonce: 1n,
      calls: [
        { target: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c", data: wrap, value: 1n },
        { target: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c", data: approve },
        { target: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30", data: swap },
      ],
    });
    expect(d.ok).toBe(true);
    expect(d.detail).toMatch(/depends on wrap/);
  });

  it("DENYs a swap-only revert when no wrap/approve precedes it", async () => {
    const swap = "0x414bf389" + "00".repeat(64);
    const d = await simulateVaultCalls({
      call: async () => {
        throw new Error("execution reverted: call failed");
      },
      vaultAbi: ABI,
      safe: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30",
      executor: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
      nonce: 1n,
      calls: [{ target: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30", data: swap }],
    });
    expect(d.ok).toBe(false);
    expect(d.detail).toMatch(/eth_call\[0\] reverted/);
  });
});
