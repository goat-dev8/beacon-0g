import { describe, expect, it } from "vitest";
import { assertZeroGRequired, loadEnv, resetEnvCache } from "./env.js";
import { CHAIN_ID, ZEROG_USDCE_CCIP, ZIA_FACTORY } from "./constants.js";
import { format0g, parse0g } from "./units.js";
import { jobIdToBytes32, newId } from "./ids.js";

describe("0G env", () => {
  it("defaults to Aristotle 16661", () => {
    resetEnvCache();
    const env = loadEnv({});
    expect(env.CHAIN_ID).toBe(CHAIN_ID);
    expect(env.TEE_FAIL_CLOSED).toBe(true);
    expect(env.ENABLE_SWAP).toBe(true);
    expect(env.ENABLE_VIDEO).toBe(false);
    expect(env.ENABLE_X402).toBe(false);
    expect(env.PLATFORM_FEE_BPS).toBe(500);
    expect(env.ZIA_FACTORY).toBe(ZIA_FACTORY);
    expect(env.ZEROG_USDCE.toLowerCase()).toBe(ZEROG_USDCE_CCIP.toLowerCase());
  });

  it("assertZeroGRequired accepts a valid Aristotle env", () => {
    const source: NodeJS.ProcessEnv = {
      CHAIN_ID: "16661",
      ZEROG_RPC_URL: "https://evmrpc.0g.ai",
      TEE_FAIL_CLOSED: "true",
      ZEROG_STORAGE_INDEXER: "https://indexer-storage-turbo.0g.ai",
      ZIA_FACTORY,
    };
    const env = loadEnv(source);
    expect(() => assertZeroGRequired(source, env)).not.toThrow();
  });

  it("rejects wrong chain id", () => {
    const source: NodeJS.ProcessEnv = { CHAIN_ID: "114" };
    const env = loadEnv(source);
    expect(() => assertZeroGRequired(source, env)).toThrow(/16661/);
  });

  it("rejects simulated confidential compute", () => {
    const banned = ["SIMULATED", "TEE"].join("_");
    const source: NodeJS.ProcessEnv = {
      CHAIN_ID: "16661",
      ZEROG_RPC_URL: "https://evmrpc.0g.ai",
      TEE_FAIL_CLOSED: "true",
      ZEROG_STORAGE_INDEXER: "https://indexer-storage-turbo.0g.ai",
      [banned]: "true",
    };
    const env = loadEnv(source);
    expect(() => assertZeroGRequired(source, env)).toThrow(/not allowed/);
  });
});

describe("units", () => {
  it("parses 0G decimals to wei", () => {
    expect(parse0g("1")).toBe(10n ** 18n);
    expect(parse0g("0.001")).toBe(10n ** 15n);
    expect(format0g(parse0g("0.013"))).toContain("0.013");
  });
});

describe("ids", () => {
  it("hashes job ids to bytes32", () => {
    const id = newId();
    expect(jobIdToBytes32(id)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(jobIdToBytes32(id)).toBe(jobIdToBytes32(id));
    const raw = "0xb1c5ac5abf0c7ff569c09939ce0620390fbbb41cc8ae400278af04070696ba77";
    expect(jobIdToBytes32(raw)).toBe(raw);
  });
});
