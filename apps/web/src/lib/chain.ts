export const NETWORK = {
  chainId: 16661,
  name: "0G Aristotle",
  rpc: import.meta.env.VITE_RPC_URL ?? "https://evmrpc.0g.ai",
  explorer: "https://chainscan.0g.ai",
  storageScan: "https://storagescan.0g.ai",
  faucet: "https://get.0g.ai/",
} as const;

export const CONTRACTS = {
  escrow: (import.meta.env.VITE_BEACON_ESCROW ||
    "0xFB9c10423EAaD015dDb04f5aC85273f1B3F7A566") as `0x${string}`,
  jobRegistry: (import.meta.env.VITE_BEACON_RECEIPT_REGISTRY ||
    "0x31666B7ECf736c0c6014F0cd63C646B7f4Af3887") as `0x${string}`,
  payee: (import.meta.env.VITE_BEACON_TREASURY ||
    "0x18398aA1dFdA63F30529c46E90ac41c1E75F7Ecf") as `0x${string}`,
  safeFactory: (import.meta.env.VITE_BEACON_SAFE_FACTORY_ADDRESS ||
    "0x531e8533aBA2Ca534959Df860C3226c02EaC3eE1") as `0x${string}`,
  agentVault: (import.meta.env.VITE_BEACON_AGENT_VAULT_ADDRESS ||
    "0x6A3388D833C09a00DDbbD4e1a6c11C9623717A30") as `0x${string}`,
  w0g: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c" as `0x${string}`,
  ziaRouter: "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30" as `0x${string}`,
  ziaQuoter: "0x23b55293b7F06F6c332a0dDA3D88d8921218425B" as `0x${string}`,
  evidenceAnchor: (import.meta.env.VITE_BEACON_EVIDENCE_ANCHOR ||
    "0xB94934f848A13Ae5E7fC5B2a91E61EDFaEc4ca6B") as `0x${string}`,
} as const;
