import { describe, expect, it } from "vitest";
import { compareReceipts, chatIdHashFromPlain, compareChatIdHash, jobIdBytes32 } from "./onchainReceipt";

describe("jobIdBytes32", () => {
  it("sha256s a UUID the same way the settler does", () => {
    expect(jobIdBytes32("5d71852d-b38f-42cd-8f53-f0fc3075c9c7")).toBe(
      "0xacd1f8dbf9f889d42d1c1b873de05fc24eb73942449d8fd1455a725b4f9440ac",
    );
  });

  it("passes through an existing bytes32", () => {
    const raw = "0x" + "ab".repeat(32);
    expect(jobIdBytes32(raw)).toBe(raw);
  });
});

describe("compareReceipts", () => {
  const browser = {
    exists: true,
    storageRoot: "0xdc633b1366d30bffdc773216ee17247a0e57f0dff981ee797bfe7da86b293dc5",
    teeSigner: "0x61C0007197E7D4d6A842d6768E8035728877B9F6",
    quoteHash: "0x" + "11".repeat(32),
    allowed: true,
    rpc: "https://evmrpc.0g.ai",
    registry: "0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887",
    jobKey: "0xacd1f8dbf9f889d42d1c1b873de05fc24eb73942449d8fd1455a725b4f9440ac",
  };

  it("treats matching API + RPC as a pass", () => {
    const out = compareReceipts(
      {
        exists: true,
        storageRoot: browser.storageRoot,
        teeSigner: browser.teeSigner.toLowerCase(),
        quoteHash: browser.quoteHash,
        allowed: true,
      },
      browser,
    );
    expect(out.match).toBe(true);
  });

  it("lets live RPC win when the API disagrees", () => {
    const out = compareReceipts({ exists: true, storageRoot: "0x" + "00".repeat(32), allowed: true }, browser);
    expect(out.match).toBe(false);
    expect(out.note).toMatch(/Registry wins/);
  });

  it("is neutral when neither side has a row", () => {
    expect(compareReceipts(null, { ...browser, exists: false }).match).toBeNull();
  });
});

describe("compareChatIdHash", () => {
  it("recomputes keccak256(utf8 chatId) in the browser", () => {
    const plain = "chat-5d71852d";
    const hashed = chatIdHashFromPlain(plain);
    expect(compareChatIdHash(plain, hashed).match).toBe(true);
    expect(compareChatIdHash(plain, "0x" + "00".repeat(32)).match).toBe(false);
    expect(compareChatIdHash(null, hashed).match).toBeNull();
  });
});
