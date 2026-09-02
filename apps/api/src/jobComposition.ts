export type CompositionStep = {
  id: string;
  label: string;
  state: "pending" | "done" | "failed" | "skipped";
  evidence?: string | null;
};

export type CompositionGraph = {
  kind: "single" | "inspect-then-job";
  steps: CompositionStep[];
};

export function compositionForJob(input: {
  serviceId?: string;
  inspect?: boolean;
  status: string;
  lockTx?: string | null;
  teeAllow?: boolean | null;
  denial?: string | null;
  storageRoot?: string | null;
  settleTx?: string | null;
  receiptTx?: string | null;
}): CompositionGraph {
  const inspect = Boolean(input.inspect || input.serviceId === "analysis");
  const failed = input.status === "FAILED" || Boolean(input.denial);
  const closed = input.status === "CLOSED" || input.status === "PASSED";
  const steps: CompositionStep[] = [];
  if (inspect) {
    steps.push({
      id: "rpc",
      label: "Live RPC inspect",
      state: "done",
      evidence: "Aristotle eth_getTransaction / eth_getCode",
    });
  }
  steps.push(
    {
      id: "tee",
      label: "TeeML policy",
      state: input.teeAllow === false ? "failed" : input.teeAllow === true ? "done" : failed ? "failed" : "pending",
      evidence: input.denial ?? null,
    },
    {
      id: "compute",
      label: "0G Compute",
      state: closed || input.storageRoot ? "done" : failed ? "failed" : input.lockTx ? "pending" : "pending",
    },
    {
      id: "storage",
      label: "0G Storage",
      state: input.storageRoot ? "done" : failed ? "failed" : "pending",
      evidence: input.storageRoot ?? null,
    },
    {
      id: "settle",
      label: "Settlement",
      state: input.settleTx ? "done" : failed ? "failed" : "pending",
      evidence: input.settleTx ?? null,
    },
    {
      id: "proof",
      label: "Receipt",
      state: input.receiptTx ? "done" : failed && !input.receiptTx ? "skipped" : "pending",
      evidence: input.receiptTx ?? null,
    },
  );
  return { kind: inspect ? "inspect-then-job" : "single", steps };
}
