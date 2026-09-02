import { createHash } from "node:crypto";
import { DEFAULT_CONNECT_SCOPES, type McpScope } from "./scopes.js";

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  return pkceS256(verifier) === challenge;
}

export function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    if (protocol === "javascript:" || protocol === "data:" || protocol === "file:") return false;
    return Boolean(url.protocol && url.href.length >= 8);
  } catch {
    return false;
  }
}

export function mcpWwwAuthenticate(apiBase: string): string {
  const api = apiBase.replace(/\/$/, "");
  return `Bearer realm="beacon-mcp", resource_metadata="${api}/.well-known/oauth-protected-resource"`;
}

export function oauthProtectedResource(opts: {
  apiBase: string;
  webBase: string;
  scopes?: readonly string[];
}) {
  const api = opts.apiBase.replace(/\/$/, "");
  const web = opts.webBase.replace(/\/$/, "");
  return {
    resource: `${api}/mcp`,
    authorization_servers: [api],
    scopes_supported: opts.scopes ?? [...DEFAULT_CONNECT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${web}/flow/mcp`,
  };
}

export function oauthAuthorizationServer(opts: { apiBase: string; webBase: string }) {
  const api = opts.apiBase.replace(/\/$/, "");
  const web = opts.webBase.replace(/\/$/, "");
  return {
    issuer: api,
    authorization_endpoint: `${web}/mcp`,
    token_endpoint: `${api}/v1/mcp/oauth/token`,
    registration_endpoint: `${api}/v1/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [...DEFAULT_CONNECT_SCOPES] as McpScope[],
  };
}

export function parseOauthTokenBody(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
}
