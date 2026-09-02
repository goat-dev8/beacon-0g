export type HistoryMeta = {
  jobIds: string[];
  capability: string | null;
  status: string | null;
};

const JOB_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function historyMeta(input: {
  title?: string;
  lastMessage?: string | null;
  cards?: unknown;
}): HistoryMeta {
  const jobIds = new Set<string>();
  const blob = `${input.title ?? ""} ${input.lastMessage ?? ""} ${JSON.stringify(input.cards ?? [])}`;
  for (const match of blob.match(JOB_RE) ?? []) jobIds.add(match.toLowerCase());

  const cards = Array.isArray(input.cards) ? input.cards : [];
  let capability: string | null = null;
  let status: string | null = null;
  for (const raw of cards) {
    const card = raw as Record<string, unknown>;
    const type = String(card.type ?? "");
    if (type === "swap_prepare" || type === "swap_assets") capability = "swap";
    else if (type === "inspect_result") capability = "inspect";
    else if (type === "bridge_catalog" || type === "bridge_quote") capability = "bridge";
    else if (type === "media_result" || type === "desk_link" || type === "job_offer") {
      capability = capability ?? "job";
    }
    else if (type === "denied") {
      capability = capability ?? "policy";
      status = "denied";
    }
    if (typeof card.href === "string") {
      const fromHref = card.href.match(JOB_RE);
      if (fromHref) for (const id of fromHref) jobIds.add(id.toLowerCase());
    }
    if (typeof card.jobId === "string") {
      for (const id of card.jobId.match(JOB_RE) ?? []) jobIds.add(id.toLowerCase());
    }
  }
  const lower = (input.lastMessage ?? "").toLowerCase();
  if (!capability) {
    if (/swap|zia/.test(lower)) capability = "swap";
    else if (/image|lighthouse/.test(lower)) capability = "image";
    else if (/bridge/.test(lower)) capability = "bridge";
    else if (/inspect|contract|wallet/.test(lower)) capability = "inspect";
    else if (/quote|lock/.test(lower)) capability = "job";
  }
  if (!status) {
    if (/success|closed|released/.test(lower)) status = "complete";
    else if (/refund/.test(lower)) status = "refunded";
    else if (/denied|blocked/.test(lower)) status = "denied";
    else if (/quote/.test(lower)) status = "quoted";
  }
  return { jobIds: [...jobIds], capability, status };
}
