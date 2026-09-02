import { Interface, id, type Provider } from "ethers";
import { ERC8004_IDENTITY, ERC8004_REPUTATION, ZEROG_EXPLORER } from "@beacon/shared";

export type FeedbackCandidate = {
  name: string;
  selector: string;
  inBytecode: boolean;
  call: "ok" | "revert" | "skipped";
  reason?: string;
};

export type Erc8004Status = {
  identity: string;
  reputation: string;
  identityCodeBytes: number;
  reputationCodeBytes: number;
  explorerIdentity: string;
  explorerReputation: string;
  giveFeedback: "REAL" | "SELECTOR_PRESENT" | "NOT_AVAILABLE";
  workingSelector: string | null;
  candidates: FeedbackCandidate[];
  honesty: string;
};

const FEEDBACK_IFACES: Array<{ name: string; iface: Interface; args: unknown[] }> = [
  {
    name: "giveFeedback(uint256,uint8,bytes32,bytes32,string,bytes32)",
    iface: new Interface([
      "function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string feedbackUri, bytes32 feedbackHash)",
    ]),
    args: [3531902n, 80, "0x" + "00".repeat(32), "0x" + "00".repeat(32), "https://beacon-0g.vercel.app", "0x" + "00".repeat(32)],
  },
  {
    name: "giveFeedback(uint256,int128,uint8,string,string,string,bytes32)",
    iface: new Interface([
      "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, bytes32 feedbackHash)",
    ]),
    args: [3531902n, 80n, 0, "quality", "beacon", "https://beacon-0g.vercel.app", "0x" + "00".repeat(32)],
  },
  {
    name: "giveFeedback(uint256,int8,bytes32,string)",
    iface: new Interface([
      "function giveFeedback(uint256 agentId, int8 score, bytes32 tag, string fileuri)",
    ]),
    args: [3531902n, 80, "0x" + "00".repeat(32), "https://beacon-0g.vercel.app"],
  },
  {
    name: "giveFeedback(uint256,uint8,string,bytes32)",
    iface: new Interface([
      "function giveFeedback(uint256 agentId, uint8 score, string comment, bytes32 tag)",
    ]),
    args: [3531902n, 80, "Beacon 0G live desk", "0x" + "00".repeat(32)],
  },
];

function selectorOf(name: string): string {
  return id(name).slice(0, 10);
}

export async function probeErc8004(
  provider: Provider,
  opts: { identity?: string; reputation?: string } = {},
): Promise<Erc8004Status> {
  const identity = (opts.identity || ERC8004_IDENTITY).toLowerCase();
  const reputation = (opts.reputation || ERC8004_REPUTATION).toLowerCase();
  const [identityCode, reputationCode] = await Promise.all([
    provider.getCode(identity),
    provider.getCode(reputation),
  ]);
  const identityCodeBytes = identityCode && identityCode !== "0x" ? (identityCode.length - 2) / 2 : 0;
  const reputationCodeBytes = reputationCode && reputationCode !== "0x" ? (reputationCode.length - 2) / 2 : 0;
  const lowered = (reputationCode || "").toLowerCase();

  const candidates: FeedbackCandidate[] = [];
  let workingSelector: string | null = null;
  for (const cand of FEEDBACK_IFACES) {
    const selector = selectorOf(cand.name);
    const inBytecode = reputationCodeBytes > 0 && lowered.includes(selector.slice(2));
    let call: FeedbackCandidate["call"] = "skipped";
    let reason: string | undefined;
    if (reputationCodeBytes === 0) {
      reason = "Reputation registry has no bytecode on Aristotle.";
    } else {
      try {
        const data = cand.iface.encodeFunctionData("giveFeedback", cand.args);
        await provider.call({ to: reputation, data });
        call = "ok";
        workingSelector = cand.name;
      } catch (err) {
        call = "revert";
        reason = err instanceof Error ? err.message.slice(0, 280) : "eth_call reverted";
        if (inBytecode && !workingSelector) workingSelector = cand.name;
      }
    }
    candidates.push({ name: cand.name, selector, inBytecode, call, reason });
  }

  const anyOk = candidates.some((c) => c.call === "ok");
  const anySel = candidates.some((c) => c.inBytecode);
  const giveFeedback: Erc8004Status["giveFeedback"] = anyOk
    ? "REAL"
    : anySel
      ? "SELECTOR_PRESENT"
      : "NOT_AVAILABLE";

  return {
    identity,
    reputation,
    identityCodeBytes,
    reputationCodeBytes,
    explorerIdentity: `${ZEROG_EXPLORER}/address/${identity}`,
    explorerReputation: `${ZEROG_EXPLORER}/address/${reputation}`,
    giveFeedback,
    workingSelector: anyOk ? workingSelector : anySel ? workingSelector : null,
    candidates,
    honesty: anyOk
      ? "eth_call for giveFeedback succeeded. POST /v1/erc8004/feedback can submit a real tx."
      : anySel
        ? "Selector is in bytecode but eth_call reverted (auth, agentId, or args). Beacon will not fake a receipt."
        : "No giveFeedback selector matched on Aristotle. Identity register() is separate. Not faked.",
  };
}

export function encodeGiveFeedback(selectorName: string): { toData: (agentId: bigint, uri: string) => string } | null {
  const cand = FEEDBACK_IFACES.find((c) => c.name === selectorName);
  if (!cand) return null;
  return {
    toData(agentId, uri) {
      const args = [...cand.args];
      args[0] = agentId;
      const uriIdx = cand.args.findIndex((a) => typeof a === "string" && String(a).startsWith("http"));
      if (uriIdx >= 0) args[uriIdx] = uri;
      return cand.iface.encodeFunctionData("giveFeedback", args);
    },
  };
}
