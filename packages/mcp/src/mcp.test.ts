import { describe, expect, it } from "vitest";
import { authorizeToolCall } from "./policyGate.js";
import { filterValidScopes, hasScope } from "./scopes.js";
import {
  issueMcpAccessToken,
  verifyMcpAccessToken,
  issueMcpRefreshToken,
  verifyMcpRefreshToken,
  newGrantId,
  accessTtlForGrant,
} from "./tokens.js";
import { isGrantActive, type McpGrant } from "./grants.js";
import { gateTool } from "./tools.js";
import { buildConnectCard } from "./index.js";
import {
  oauthAuthorizationServer,
  oauthProtectedResource,
  pkceS256,
  verifyPkce,
  isSafeRedirectUri,
  mcpWwwAuthenticate,
  parseOauthTokenBody,
} from "./oauth.js";
import { handleMcpJsonRpc, negotiateProtocolVersion, isMcpNotification } from "./protocol.js";

const secret = "test-session-secret-for-mcp";

function sampleGrant(over: Partial<McpGrant> = {}): McpGrant {
  return {
    id: newGrantId(),
    wallet: "0xabc0000000000000000000000000000000000001",
    safeAddress: "0xsafe000000000000000000000000000000000001",
    clientKind: "cursor",
    clientLabel: "Cursor",
    scopes: ["read:safe", "read:policy", "exec:swap"],
    maxSpendPerTx0g: 5,
    dailyLimit0g: 20,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    revokedAt: null,
    refreshTokenHash: null,
    ...over,
  };
}

describe("mcp scopes", () => {
  it("filters invalid scopes", () => {
    expect(filterValidScopes(["read:safe", "hack", "exec:swap"])).toEqual([
      "read:safe",
      "exec:swap",
    ]);
  });

  it("includes 0G exec scopes", () => {
    expect(
      filterValidScopes(["exec:infer", "exec:image", "exec:bridge", "exec:inspect", "read:receipts"]),
    ).toEqual(["exec:infer", "exec:image", "exec:bridge", "exec:inspect", "read:receipts"]);
  });
});

describe("mcp tokens", () => {
  it("issues and verifies access tokens", () => {
    const grantId = newGrantId();
    const { token, expiresAt } = issueMcpAccessToken({
      grantId,
      wallet: "0xAbC0000000000000000000000000000000000001",
      secret,
    });
    const v = verifyMcpAccessToken(token, secret);
    expect(v?.grantId).toBe(grantId);
    expect(v?.wallet).toBe("0xabc0000000000000000000000000000000000001");
    expect(v?.expiresAt).toBe(expiresAt);
  });

  it("grant access TTL matches remaining grant life, not 1h", () => {
    const now = 1_700_000_000;
    const expiresAt = new Date((now + 7 * 24 * 3600) * 1000).toISOString();
    expect(accessTtlForGrant(expiresAt, now)).toBe(7 * 24 * 3600);
  });

  it("rejects tampered tokens", () => {
    const { token } = issueMcpAccessToken({
      grantId: "mcp_x",
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
    });
    expect(verifyMcpAccessToken(token + "x", secret)).toBeNull();
  });

  it("rejects expired access tokens", () => {
    const { token } = issueMcpAccessToken({
      grantId: "mcp_x",
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
      nowSeconds: 10,
      ttlSeconds: 5,
    });
    expect(verifyMcpAccessToken(token, secret, 100)).toBeNull();
  });

  it("refresh tokens work", () => {
    const grantId = newGrantId();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const refresh = issueMcpRefreshToken({
      grantId,
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
      expiresAt: exp,
    });
    const v = verifyMcpRefreshToken(refresh, secret);
    expect(v?.grantId).toBe(grantId);
  });
});

describe("mcp policy gate", () => {
  const policy = {
    emergencyPause: false,
    dailySpend0g: 50,
    perJobLimit0g: 10,
    spentToday0g: 0,
  };

  it("allows swap within limits", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amount0g: 3,
      policy,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects swap above MCP tx limit", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amount0g: 100,
      policy,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MCP_TX_LIMIT");
  });

  it("rejects missing scope", () => {
    const r = authorizeToolCall({
      grant: sampleGrant({ scopes: ["read:safe"] }),
      neededScope: "exec:swap",
      amount0g: 1,
      policy,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCOPE_DENIED");
  });

  it("rejects paused policy", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amount0g: 1,
      policy: { ...policy, emergencyPause: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SAFE_PAUSED");
  });

  it("gateTool rejects overspend", () => {
    const g = gateTool(sampleGrant(), "swap", { amount0g: 100 }, policy);
    expect(g.ok).toBe(false);
  });

  it("isGrantActive respects revoke/expiry", () => {
    expect(isGrantActive(sampleGrant()).ok).toBe(true);
    expect(isGrantActive(sampleGrant({ revokedAt: new Date().toISOString() })).ok).toBe(
      false,
    );
    expect(
      isGrantActive(
        sampleGrant({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ).ok,
    ).toBe(false);
  });

  it("hasScope works", () => {
    expect(hasScope(["read:safe"], "read:safe")).toBe(true);
    expect(hasScope(["read:safe"], "exec:swap")).toBe(false);
  });

  it("builds a copyable connect card", () => {
    const card = buildConnectCard({
      mcpEndpoint: "https://beacon-0g-api.onrender.com/mcp",
      accessToken: "tok_test",
      wallet: "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf",
      safeAddress: "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30",
      chainId: 16661,
      scopes: ["read:safe", "exec:job"],
      maxSpendPerTx0g: 5,
      dailyLimit0g: 20,
      expiresAt: "2026-09-09T00:00:00.000Z",
    });
    expect(card).toContain("BEACON MCP");
    expect(card).toContain("Bearer tok_test");
    expect(card).toContain("16661");
    expect(card).toContain("5 0G");
    expect(card).toContain("20 0G");
    expect(card).toContain("Paste this into your MCP client configuration.");
  });
});

describe("mcp oauth helpers", () => {
  it("verifies PKCE S256", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = pkceS256(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier + "x", challenge)).toBe(false);
  });

  it("rejects javascript redirect URIs", () => {
    expect(isSafeRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectUri("https://beacon-0g.vercel.app/mcp")).toBe(true);
    expect(isSafeRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
  });

  it("advertises protected-resource metadata for discovery", () => {
    const meta = oauthProtectedResource({
      apiBase: "https://beacon-0g-api.onrender.com",
      webBase: "https://beacon-0g.vercel.app",
    });
    expect(meta.resource).toBe("https://beacon-0g-api.onrender.com/mcp");
    expect(mcpWwwAuthenticate("https://beacon-0g-api.onrender.com")).toContain(
      "oauth-protected-resource",
    );
    const as = oauthAuthorizationServer({
      apiBase: "https://beacon-0g-api.onrender.com",
      webBase: "https://beacon-0g.vercel.app",
    });
    expect(as.authorization_endpoint).toBe("https://beacon-0g.vercel.app/mcp");
    expect(as.grant_types_supported).toContain("authorization_code");
  });

  it("parses form and JSON token bodies", () => {
    expect(parseOauthTokenBody({ grant_type: "authorization_code", code: "abc" }).code).toBe("abc");
  });
});

describe("mcp protocol", () => {
  it("negotiates known protocol versions", () => {
    expect(negotiateProtocolVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateProtocolVersion("nope")).toBe("2025-03-26");
  });

  it("treats initialized as a notification when id is omitted", () => {
    expect(isMcpNotification({ method: "notifications/initialized" })).toBe(true);
    expect(isMcpNotification({ id: 1, method: "initialize" })).toBe(false);
  });

  it("initialize echoes a supported protocol version", () => {
    const res = handleMcpJsonRpc(
      { id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      sampleGrant(),
      async () => ({ content: [] }),
    );
    if (res instanceof Promise) throw new Error("initialize should be sync");
    expect(res.result).toMatchObject({ protocolVersion: "2025-03-26" });
  });
});

describe("mcp extra tools", () => {
  it("exposes quote_swap and preflight_tx for swap scope", () => {
    const g = sampleGrant();
    expect(gateTool(g, "quote_swap", { amount0g: 0.1 }, {
      emergencyPause: false,
      dailySpend0g: 50,
      perJobLimit0g: 10,
      spentToday0g: 0,
    }).ok).toBe(true);
    expect(gateTool(g, "preflight_tx", { amount0g: 0.1 }, {
      emergencyPause: false,
      dailySpend0g: 50,
      perJobLimit0g: 10,
      spentToday0g: 0,
    }).ok).toBe(true);
  });

  it("denies swap without exec:swap", () => {
    const g = sampleGrant({ scopes: ["read:safe"] });
    expect(gateTool(g, "execute_swap", { amount0g: 0.1 }, {
      emergencyPause: false,
      dailySpend0g: 50,
      perJobLimit0g: 10,
      spentToday0g: 0,
    }).ok).toBe(false);
  });
});
