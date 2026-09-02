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
});
