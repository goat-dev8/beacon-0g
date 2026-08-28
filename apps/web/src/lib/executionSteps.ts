import type { JobStatus } from "./types";

export interface ExecutionStep {
  id: string;
  label: string;
  detail: string;
  statusKey: JobStatus | "LOCK";
}

export const ZEROG_STEPS_WALLET: ExecutionStep[] = [
  {
    id: "wallet",
    label: "Wallet on 0G Aristotle",
    detail: "EIP-1193 connect · chain 16661",
    statusKey: "LOCK",
  },
  {
    id: "auth",
    label: "Native 0G ready",
    detail: "Fund gas + job lock in native 0G",
    statusKey: "AUTHORIZED",
  },
  {
    id: "lock",
    label: "BeaconJobEscrow.lockNative",
    detail: "Funds locked on Aristotle until quality passes",
    statusKey: "AUTHORIZED",
  },
  {
    id: "generate",
    label: "0G Compute",
    detail: "Live catalog model · TeeML when the job requires it",
    statusKey: "GENERATING",
  },
  {
    id: "accept",
    label: "TEE + Storage",
    detail: "processResponse / EIP-191 · Flow root on Storage Scan",
    statusKey: "ACCEPTING",
  },
  {
    id: "settle",
    label: "Escrow release / refund",
    detail: "release or refund native 0G on BeaconJobEscrow",
    statusKey: "SETTLING",
  },
  {
    id: "receipt",
    label: "Receipt recorded",
    detail: "/verify links lock, Compute, Storage, and settlement",
    statusKey: "CLOSED",
  },
];

export const ZEROG_STEPS_SAFE: ExecutionStep[] = [
  {
    id: "safe",
    label: "Beacon Safe funded",
    detail: "Prepaid native 0G · policy caps on Aristotle",
    statusKey: "LOCK",
  },
  {
    id: "spend",
    label: "Safe vault.execute",
    detail: "Executor locks 0G Safe → BeaconJobEscrow",
    statusKey: "AUTHORIZED",
  },
  {
    id: "lock",
    label: "BeaconJobEscrow.lockNative",
    detail: "Refunds return to the Safe",
    statusKey: "AUTHORIZED",
  },
  {
    id: "generate",
    label: "0G Compute",
    detail: "Live catalog · no hidden cloud fallback",
    statusKey: "GENERATING",
  },
  {
    id: "accept",
    label: "TEE + Storage",
    detail: "Verified ALLOW · encrypted evidence blob",
    statusKey: "ACCEPTING",
  },
  {
    id: "settle",
    label: "Escrow release / refund",
    detail: "release to treasury or refund to Safe",
    statusKey: "SETTLING",
  },
  {
    id: "receipt",
    label: "Receipt recorded",
    detail: "Database + on-chain receipt registry",
    statusKey: "CLOSED",
  },
];

export const ZEROG_STEPS = ZEROG_STEPS_WALLET;

const ORDER: JobStatus[] = [
  "AUTHORIZED",
  "PREPARING",
  "GENERATING",
  "COMPOSING",
  "ACCEPTING",
  "PASSED",
  "SETTLING",
  "CLOSED",
];

export function executionStepState(
  step: ExecutionStep,
  status: JobStatus | undefined,
  hasLock: boolean,
): "done" | "active" | "todo" {
  const effective: JobStatus | undefined =
    hasLock && (!status || status === "QUOTED" || status === "DRAFT")
      ? "AUTHORIZED"
      : status;

  if (!effective) return "todo";

  if (step.statusKey === "LOCK") {
    return hasLock || ORDER.indexOf(effective) >= 0 ? "done" : "todo";
  }

  if (effective === "FAILED" || effective === "REFUSING") {
    const i = ORDER.indexOf(step.statusKey as JobStatus);
    const acceptIdx = ORDER.indexOf("ACCEPTING");
    if (effective === "FAILED" && step.id === "generate") return "done";
    if (i >= 0 && i <= acceptIdx) return "done";
    if (step.id === "settle" || step.id === "receipt") return "done";
    return "todo";
  }

  const cur = ORDER.indexOf(effective);
  if (cur < 0) return "todo";

  if (step.id === "spend" || step.id === "auth" || step.id === "lock") {
    if (hasLock || cur > ORDER.indexOf("AUTHORIZED")) return "done";
    if (effective === "AUTHORIZED") return step.id === "lock" ? "active" : "done";
    return "todo";
  }

  const stepIdx = ORDER.indexOf(step.statusKey as JobStatus);
  if (stepIdx < 0) return "todo";
  if (effective === "CLOSED" || effective === "PASSED") return "done";
  if (
    step.statusKey === "GENERATING" &&
    (effective === "AUTHORIZED" ||
      effective === "PREPARING" ||
      effective === "GENERATING" ||
      effective === "COMPOSING")
  ) {
    return "active";
  }
  if (cur > stepIdx) return "done";
  if (cur === stepIdx) return "active";
  return "todo";
}
