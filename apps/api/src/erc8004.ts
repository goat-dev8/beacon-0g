import {
  Interface,
  Wallet,
  getAddress,
  id,
  keccak256,
  toUtf8Bytes,
  type Provider,
  type TransactionReceipt,
} from "ethers";
import {
  ERC8004_AGENT_ID,
  ERC8004_GIVE_FEEDBACK_SELECTOR,
  ERC8004_IDENTITY,
  ERC8004_REPUTATION,
  ZEROG_EXPLORER,
} from "@beacon/shared";

/** Official ERC-8004 ReputationRegistry.giveFeedback — 8 arguments including feedbackURI. */
export const GIVE_FEEDBACK_SIGNATURE =
  "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)";

export const REPUTATION_IFACE = new Interface([
  "function getIdentityRegistry() view returns (address)",
  "function getVersion() view returns (string)",
  "function getClients(uint256 agentId) view returns (address[])",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
  `function ${GIVE_FEEDBACK_SIGNATURE}`,
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

const IDENTITY_IFACE = new Interface([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function setAgentURI(uint256 agentId, string newURI)",
]);

const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

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
  reputationImplementation: string | null;
  implementationCodeBytes: number;
  identityRegistryFromReputation: string | null;
  version: string | null;
  agentId: string;
  agentOwner: string | null;
  agentWallet: string | null;
  tokenURI: string | null;
  clients: string[];
  explorerIdentity: string;
  explorerReputation: string;
  giveFeedback: "REAL" | "SELECTOR_PRESENT" | "NOT_AVAILABLE";
  workingSelector: string | null;
  selector: string;
  ownerBlocked: boolean;
  clientMustNotBeOwner: true;
  candidates: FeedbackCandidate[];
  honesty: string;
};

export type JobFeedbackInput = {
  jobId: string;
  task: string;
  outcome: "successful_job" | "failed_job";
  proofUrl: string;
  releaseTx?: string | null;
  refundTx?: string | null;
  receiptTx?: string | null;
  storageRoot?: string | null;
  endpoint?: string;
};

function addressFromSlot(raw: string | null | undefined): string | null {
  if (!raw || raw === "0x") return null;
  const hex = raw.replace(/^0x/, "").padStart(64, "0");
  if (/^0+$/.test(hex)) return null;
  try {
    return getAddress(`0x${hex.slice(24)}`);
  } catch {
    return null;
  }
}

async function tryCall(
  provider: Provider,
  tx: { to: string; data: string; from?: string },
): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  try {
    const out = await provider.call(tx);
    return { ok: true, out };
  } catch (err) {
    const msg =
      err && typeof err === "object" && "shortMessage" in err
        ? String((err as { shortMessage?: string }).shortMessage)
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: msg.slice(0, 320) };
  }
}

export function giveFeedbackSelector(): string {
  return id(GIVE_FEEDBACK_SIGNATURE).slice(0, 10);
}

export function encodeGiveFeedback(
  selectorName: string,
): { toData: (agentId: bigint, uri: string) => string } | null {
  if (selectorName !== GIVE_FEEDBACK_SIGNATURE && selectorName !== "official") return null;
  return {
    toData(agentId, uri) {
      return REPUTATION_IFACE.encodeFunctionData("giveFeedback", [
        agentId,
        1n,
        0,
        "cheap",
        "successful_job",
        "https://beacon-0g-api.onrender.com/mcp",
        uri,
        keccak256(toUtf8Bytes(uri)),
      ]);
    },
  };
}

export function encodeOfficialGiveFeedback(args: {
  agentId: bigint;
  value: bigint;
  valueDecimals?: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: string;
}): string {
  return REPUTATION_IFACE.encodeFunctionData("giveFeedback", [
    args.agentId,
    args.value,
    args.valueDecimals ?? 0,
    args.tag1,
    args.tag2,
    args.endpoint,
    args.feedbackURI,
    args.feedbackHash,
  ]);
}

export function canonicalFeedback(input: JobFeedbackInput): {
  json: string;
  hash: string;
  uri: string;
  tag1: string;
  tag2: string;
  value: bigint;
} {
  const body = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#feedback",
    agentRegistry: `eip155:16661:${ERC8004_IDENTITY}`,
    agentId: ERC8004_AGENT_ID.toString(),
    jobId: input.jobId,
    tag1: input.task.slice(0, 32),
    tag2: input.outcome,
    value: input.outcome === "successful_job" ? 1 : -1,
    valueDecimals: 0,
    releaseTx: input.releaseTx ?? null,
    refundTx: input.refundTx ?? null,
    receiptTx: input.receiptTx ?? null,
    storageRoot: input.storageRoot ?? null,
    createdAt: new Date().toISOString(),
  };
  const json = JSON.stringify(body);
  return {
    json,
    hash: keccak256(toUtf8Bytes(json)),
    uri: input.proofUrl,
    tag1: body.tag1,
    tag2: body.tag2,
    value: BigInt(body.value),
  };
}

/** Dedicated client EOA — must not be the agent owner (spec forbids self-feedback). */
export function feedbackClientWallet(secret: string): Wallet {
  return new Wallet(keccak256(toUtf8Bytes(`beacon-0g-erc8004-client:v1:${secret}`)));
}

export function parseNewFeedback(receipt: TransactionReceipt): {
  agentId: string;
  clientAddress: string;
  feedbackIndex: string;
  value: string;
  tag1: string;
  tag2: string;
  feedbackURI: string;
} | null {
  for (const log of receipt.logs) {
    try {
      const parsed = REPUTATION_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name !== "NewFeedback") continue;
      return {
        agentId: parsed.args.agentId.toString(),
        clientAddress: String(parsed.args.clientAddress),
        feedbackIndex: parsed.args.feedbackIndex.toString(),
        value: parsed.args.value.toString(),
        tag1: String(parsed.args.tag1),
        tag2: String(parsed.args.tag2),
        feedbackURI: String(parsed.args.feedbackURI),
      };
    } catch {
      /* not this event */
    }
  }
  return null;
}

export async function probeErc8004(
  provider: Provider,
  opts: { identity?: string; reputation?: string; agentId?: bigint; ownerCandidate?: string } = {},
): Promise<Erc8004Status> {
  const identity = getAddress(opts.identity || ERC8004_IDENTITY);
  const reputation = getAddress(opts.reputation || ERC8004_REPUTATION);
  const agentId = opts.agentId ?? ERC8004_AGENT_ID;
  const selector = giveFeedbackSelector();

  const [identityCode, reputationCode, implSlot] = await Promise.all([
    provider.getCode(identity),
    provider.getCode(reputation),
    provider.getStorage(reputation, EIP1967_IMPL_SLOT),
  ]);
  const identityCodeBytes = identityCode && identityCode !== "0x" ? (identityCode.length - 2) / 2 : 0;
  const reputationCodeBytes = reputationCode && reputationCode !== "0x" ? (reputationCode.length - 2) / 2 : 0;
  const reputationImplementation = addressFromSlot(implSlot);
  const implCode = reputationImplementation ? await provider.getCode(reputationImplementation) : "0x";
  const implementationCodeBytes = implCode && implCode !== "0x" ? (implCode.length - 2) / 2 : 0;
  const haystack = `${reputationCode}${implCode}`.toLowerCase();
  const inBytecode = haystack.includes(selector.slice(2).toLowerCase());

  let identityRegistryFromReputation: string | null = null;
  let version: string | null = null;
  let agentOwner: string | null = null;
  let agentWallet: string | null = null;
  let tokenURI: string | null = null;
  let clients: string[] = [];

  const idReg = await tryCall(provider, {
    to: reputation,
    data: REPUTATION_IFACE.encodeFunctionData("getIdentityRegistry"),
  });
  if (idReg.ok) {
    identityRegistryFromReputation = getAddress(
      String(REPUTATION_IFACE.decodeFunctionResult("getIdentityRegistry", idReg.out)[0]),
    );
  }
  const ver = await tryCall(provider, {
    to: reputation,
    data: REPUTATION_IFACE.encodeFunctionData("getVersion"),
  });
  if (ver.ok) version = String(REPUTATION_IFACE.decodeFunctionResult("getVersion", ver.out)[0]);

  const ownerCall = await tryCall(provider, {
    to: identity,
    data: IDENTITY_IFACE.encodeFunctionData("ownerOf", [agentId]),
  });
  if (ownerCall.ok) {
    agentOwner = getAddress(String(IDENTITY_IFACE.decodeFunctionResult("ownerOf", ownerCall.out)[0]));
  }
  const walletCall = await tryCall(provider, {
    to: identity,
    data: IDENTITY_IFACE.encodeFunctionData("getAgentWallet", [agentId]),
  });
  if (walletCall.ok) {
    agentWallet = getAddress(String(IDENTITY_IFACE.decodeFunctionResult("getAgentWallet", walletCall.out)[0]));
  }
  const uriCall = await tryCall(provider, {
    to: identity,
    data: IDENTITY_IFACE.encodeFunctionData("tokenURI", [agentId]),
  });
  if (uriCall.ok) tokenURI = String(IDENTITY_IFACE.decodeFunctionResult("tokenURI", uriCall.out)[0]);

  const clientsCall = await tryCall(provider, {
    to: reputation,
    data: REPUTATION_IFACE.encodeFunctionData("getClients", [agentId]),
  });
  if (clientsCall.ok) {
    clients = [...REPUTATION_IFACE.decodeFunctionResult("getClients", clientsCall.out)[0]].map((a) =>
      getAddress(String(a)),
    );
  }

  const sample = encodeOfficialGiveFeedback({
    agentId,
    value: 1n,
    tag1: "cheap",
    tag2: "successful_job",
    endpoint: "https://beacon-0g-api.onrender.com/mcp",
    feedbackURI: "https://beacon-0g.vercel.app/verify",
    feedbackHash: keccak256(toUtf8Bytes("probe")),
  });

  const ownerFrom = opts.ownerCandidate || agentOwner || undefined;
  let ownerBlocked = false;
  if (ownerFrom) {
    const ownerSim = await tryCall(provider, { to: reputation, from: ownerFrom, data: sample });
    ownerBlocked = !ownerSim.ok && /self-feedback/i.test(ownerSim.ok === false ? ownerSim.error : "");
    if (!ownerSim.ok && /self-feedback/i.test(ownerSim.error)) ownerBlocked = true;
  }

  const stranger = "0x1111111111111111111111111111111111111111";
  const sim = await tryCall(provider, { to: reputation, from: stranger, data: sample });
  const call: FeedbackCandidate["call"] = sim.ok ? "ok" : reputationCodeBytes === 0 ? "skipped" : "revert";

  const candidates: FeedbackCandidate[] = [
    {
      name: GIVE_FEEDBACK_SIGNATURE,
      selector,
      inBytecode,
      call,
      reason: sim.ok
        ? undefined
        : sim.ok === false
          ? sim.error
          : "Reputation proxy has no implementation bytecode.",
    },
  ];

  const giveFeedback: Erc8004Status["giveFeedback"] = sim.ok
    ? "REAL"
    : inBytecode
      ? "SELECTOR_PRESENT"
      : "NOT_AVAILABLE";

  return {
    identity,
    reputation,
    identityCodeBytes,
    reputationCodeBytes,
    reputationImplementation,
    implementationCodeBytes,
    identityRegistryFromReputation,
    version,
    agentId: agentId.toString(),
    agentOwner,
    agentWallet,
    tokenURI,
    clients,
    explorerIdentity: `${ZEROG_EXPLORER}/address/${identity}`,
    explorerReputation: `${ZEROG_EXPLORER}/address/${reputation}`,
    giveFeedback,
    workingSelector: giveFeedback === "NOT_AVAILABLE" ? null : GIVE_FEEDBACK_SIGNATURE,
    selector: ERC8004_GIVE_FEEDBACK_SELECTOR,
    ownerBlocked,
    clientMustNotBeOwner: true,
    candidates,
    honesty: sim.ok
      ? `Official ${GIVE_FEEDBACK_SIGNATURE} is live on the Reputation implementation (${reputationImplementation ?? "unknown"}). Agent owner cannot submit (self-feedback). Beacon uses a dedicated client EOA.`
      : inBytecode
        ? "Selector is in implementation bytecode but eth_call reverted. Beacon will not fake a receipt."
        : "Official giveFeedback selector was not found on the Reputation proxy or its EIP-1967 implementation. Not faked.",
  };
}

export function encodeSetAgentUri(agentId: bigint, uri: string): string {
  return IDENTITY_IFACE.encodeFunctionData("setAgentURI", [agentId, uri]);
}

export { IDENTITY_IFACE };
