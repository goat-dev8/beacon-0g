/** MCP permission scopes — server-enforced; models never decide allow/deny. */

export const MCP_READ_SCOPES = [
  "read:safe",
  "read:policy",
  "read:jobs",
  "read:receipts",
  "read:spend",
] as const;

export const MCP_EXEC_SCOPES = [
  "exec:job",
  "exec:infer",
  "exec:image",
  "exec:swap",
  "exec:pause",
] as const;

export const MCP_ALL_SCOPES = [...MCP_READ_SCOPES, ...MCP_EXEC_SCOPES] as const;

export type McpScope = (typeof MCP_ALL_SCOPES)[number];

export const SCOPE_LABELS: Record<McpScope, string> = {
  "read:safe": "View your Beacon vault on 0G Aristotle",
  "read:policy": "View spending limits",
  "read:jobs": "View Agent Jobs",
  "read:receipts": "View job receipts and proofs",
  "read:spend": "View 0G spend / remaining budget",
  "exec:job": "Start / approve Agent Jobs within limits",
  "exec:infer": "Run text inference within limits",
  "exec:image": "Run image generation within limits",
  "exec:swap": "Run Zia W0G swaps within limits",
  "exec:pause": "Pause the Beacon vault",
};

export const DEFAULT_CONNECT_SCOPES: McpScope[] = [
  "read:safe",
  "read:policy",
  "read:jobs",
  "read:receipts",
  "read:spend",
  "exec:job",
  "exec:infer",
  "exec:image",
  "exec:swap",
  "exec:pause",
];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_ALL_SCOPES as readonly string[]).includes(value);
}

export function hasScope(granted: readonly string[], needed: McpScope): boolean {
  return granted.includes(needed);
}

export function filterValidScopes(input: unknown): McpScope[] {
  if (!Array.isArray(input)) return [];
  const out: McpScope[] = [];
  for (const item of input) {
    if (typeof item === "string" && isMcpScope(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}
