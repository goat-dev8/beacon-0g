export type GuardMode = "UNANIMOUS" | "MAJORITY" | "ANY-REJECT";

export type GuardVote = {
  name: string;
  allow: boolean;
  reason: string;
  kind: "hard" | "model";
};

export type GuardReport = {
  mode: GuardMode;
  votes: GuardVote[];
  allow: boolean;
  reason: string;
};

/**
 * Hard votes always win. Model votes cannot override a deterministic DENY.
 */
export function aggregateGuards(votes: GuardVote[], mode: GuardMode = "ANY-REJECT"): GuardReport {
  const hardDeny = votes.filter((v) => v.kind === "hard" && !v.allow);
  if (hardDeny.length > 0) {
    return {
      mode,
      votes,
      allow: false,
      reason: hardDeny.map((v) => `${v.name}: ${v.reason}`).join("; "),
    };
  }
  const considered = votes.filter((v) => v.kind === "hard" || v.allow || !v.allow);
  const allows = considered.filter((v) => v.allow).length;
  const denies = considered.filter((v) => !v.allow);
  let allow = true;
  let reason = "All guards ALLOW.";
  if (mode === "UNANIMOUS") {
    allow = denies.length === 0 && considered.length > 0;
    if (!allow) reason = denies.map((v) => `${v.name}: ${v.reason}`).join("; ") || "No guard votes.";
  } else if (mode === "MAJORITY") {
    allow = allows > denies.length;
    if (!allow) reason = `Majority DENY (${denies.length}/${considered.length}).`;
  } else {
    allow = denies.length === 0 && considered.length > 0;
    if (!allow) reason = denies.map((v) => `${v.name}: ${v.reason}`).join("; ") || "No guard votes.";
  }
  return { mode, votes, allow, reason: allow ? "All hard rules passed. Model votes stayed inside the envelope." : reason };
}
