/** 0G Aristotle mainnet — compile-time pins. */

export const CHAIN_ID = 16661;
export const NETWORK_NAME = "aristotle";

export const ZEROG_RPC_URL = "https://evmrpc.0g.ai";
export const ZEROG_EXPLORER = "https://chainscan.0g.ai";
export const ZEROG_STORAGE_SCAN = "https://storagescan.0g.ai";
export const ZEROG_ROUTER_URL = "https://router-api.0g.ai";
export const ZEROG_STORAGE_INDEXER = "https://indexer-storage-turbo.0g.ai";

export const ZEROG_W0G = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
export const ZIA_FACTORY = "0x6F3945Ab27296D1D66D8EEb042ff1B4fb2E0CE70";
export const ZIA_ROUTER = "0x18cCa38E51c4C339A6BD6e174025f08360FEEf30";
export const ZIA_QUOTER = "0x23b55293b7F06F6c332a0dDA3D88d8921218425B";

/**
 * Bridged USDC (CCIP) on Aristotle.
 * Source: 0G docs + Zia mainnet token list. Not the unverified Ba19524 suffix.
 * Override with ZEROG_USDCE at swap time.
 */
export const ZEROG_USDCE_CCIP = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";

export const ZEROG_FLOW = "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526";
export const ZEROG_LEDGER = "0x2dE54c845Cd948B72D2e32e39586fe89607074E3";
export const ZEROG_INFERENCE = "0x47340d900bdFec2BD393c626E12ea0656F938d84";

export const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const ERC8004_REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

/** 1e18 neuron = 1 0G (Compute Router `pricing`). */
export const NEURONS_PER_0G = 10n ** 18n;

export const ZIA_DEFAULT_FEE = 3000;
export const EXACT_INPUT_SINGLE_SELECTOR = "0x414bf389";

export const DEFAULT_PLATFORM_FEE_BPS = 500;
export const DEFAULT_MAX_IMPACT_BPS = 300;
export const DEFAULT_COMPUTE_BUFFER_BPS = 200;
export const DEFAULT_MIN_JOB_LOCK_0G = "0.001";
export const QUOTE_TTL_SECONDS = 120;
