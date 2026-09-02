const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Drop javascript:/data:/relative-script URLs. */
export function safeUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://beacon.invalid");
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return "";
    if (parsed.hostname === "beacon.invalid") return "";
    return url;
  } catch {
    return "";
  }
}
