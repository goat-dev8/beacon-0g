import { describe, expect, it } from "vitest";
import { inspectAddress, inspectTransaction } from "./inspect.js";

describe("inspectAddress", () => {
  it("labels an EOA as not a contract", async () => {
    const out = await inspectAddress(
      {
        getCode: async () => "0x",
        getBalance: async () => 10n ** 18n,
      } as never,
      "0x18398aa1dfda63f30529c46e90ac41c1e75f7ecf",
    );
    expect(out.isContract).toBe(false);
    expect(out.bytecodeBytes).toBe(0);
    expect(out.risks[0]).toMatch(/EOA/);
    expect(out.verifiedSource).toBe(false);
  });

  it("reports upgrade selector hints without inventing source", async () => {
    const out = await inspectAddress(
      {
        getCode: async () => `0x${"00".repeat(32)}3659cfe6${"aa".repeat(40)}8da5cb5b`,
        getBalance: async () => 0n,
        call: async () => {
          throw new Error("no metadata");
        },
      } as never,
      "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e",
    );
    expect(out.isContract).toBe(true);
    expect(out.selectorsPresent).toContain("uups.upgradeTo");
    expect(out.verifiedSource).toBe(false);
    expect(out.risks.some((r) => /upgrade/i.test(r))).toBe(true);
  });
});

describe("inspectTransaction", () => {
  it("returns not_found when the RPC has no tx", async () => {
    const out = await inspectTransaction(
      {
        getTransaction: async () => null,
        getTransactionReceipt: async () => null,
      } as never,
      "0x" + "ab".repeat(32),
    );
    expect(out.status).toBe("not_found");
  });

  it("decodes Transfer logs without inventing an ABI", async () => {
    const hash = "0x" + "cd".repeat(32);
    const token = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";
    const from = "0x00000000000000000000000018398aa1dfda63f30529c46e90ac41c1e75f7ecf";
    const to = "0x0000000000000000000000006a3388d833c09a00ddbbd4e1a6c11c9623717a30";
    const out = await inspectTransaction(
      {
        getTransaction: async () => ({
          from: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
          to: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30",
          value: 0n,
          data: "0x414bf389",
        }),
        getTransactionReceipt: async () => ({
          status: 1,
          from: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
          to: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30",
          gasUsed: 120000n,
          logs: [
            {
              address: token,
              topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                from,
                to,
              ],
              data: "0x" + (1_000_000n).toString(16).padStart(64, "0"),
            },
          ],
        }),
      } as never,
      hash,
    );
    expect(out.status).toBe("success");
    expect(out.gasUsed).toBe("120000");
    expect(out.transfers?.[0]?.symbol).toBe("USDC.e");
    expect(out.transfers?.[0]?.display).toMatch(/USDC\.e/);
    expect(out.verifiedSource).toBeUndefined();
  });
});
