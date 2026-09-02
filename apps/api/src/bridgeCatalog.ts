export type BridgeRoute = {
  source: string;
  destination: "0G Aristotle";
  assets: string;
  venue: string;
  href: string;
  eta: string;
  executableFromBeaconSafe: false;
  reason: string;
};

/** Official 0G docs + Zia venues. Beacon Safe cannot sign a source-chain CCIP/Stargate tx. */
export const BRIDGE_CATALOG: BridgeRoute[] = [
  {
    source: "Base / Ethereum",
    destination: "0G Aristotle",
    assets: "USDC → USDC.e",
    venue: "LI.FI (Jumper)",
    href: "https://jumper.exchange/?toChain=16661",
    eta: "~2 min (live quote)",
    executableFromBeaconSafe: false,
    reason:
      "docs.0g.ai lists LI.FI with chain key zerog / 16661. Beacon quotes this live. The user wallet signs on the source chain.",
  },
  {
    source: "Ethereum / others",
    destination: "0G Aristotle",
    assets: "CCIP tokens (XSwap)",
    venue: "XSwap",
    href: "https://xswap.link/bridge?toChain=16661",
    eta: "CCIP-dependent",
    executableFromBeaconSafe: false,
    reason: "Official 0G bridge path. Beacon does not submit XSwap calldata from the Safe.",
  },
  {
    source: "Ethereum",
    destination: "0G Aristotle",
    assets: "W0G, USDC.e, oUSDT, wstETH, LINK",
    venue: "0G Hub (CCIP)",
    href: "https://hub.0g.ai/bridge?network=mainnet",
    eta: "5–15 min",
    executableFromBeaconSafe: false,
    reason: "The Hub bridge is signed on the source chain. Beacon Safe lives on Aristotle 16661.",
  },
  {
    source: "Ethereum / BNB / others",
    destination: "0G Aristotle",
    assets: "USDC.e, oUSDT, wstETH, LINK, w0G, cbBTC, wBTC",
    venue: "Interport",
    href: "https://app.interport.fi/bridge",
    eta: "5–15 min",
    executableFromBeaconSafe: false,
    reason: "Zia documents Interport as an external bridge, not a Safe allowlisted target.",
  },
  {
    source: "Ethereum",
    destination: "0G Aristotle",
    assets: "ETH, cbBTC, wBTC, 0G",
    venue: "Stargate",
    href: "https://stargate.finance/bridge",
    eta: "1–5 min",
    executableFromBeaconSafe: false,
    reason: "Zia documents Stargate. Beacon does not submit Stargate calldata from the Safe.",
  },
  {
    source: "Ethereum",
    destination: "0G Aristotle",
    assets: "Portal wrapped assets",
    venue: "Wormhole Portal",
    href: "https://portalbridge.com/?fromChain=Ethereum&toChain=ZeroGravity",
    eta: "varies",
    executableFromBeaconSafe: false,
    reason: "Zia documents PortalBridge. No Beacon executor path.",
  },
  {
    source: "Fiat / CEX withdraw",
    destination: "0G Aristotle",
    assets: "native 0G",
    venue: "get.0g.ai",
    href: "https://get.0g.ai/",
    eta: "exchange-dependent",
    executableFromBeaconSafe: false,
    reason: "get.0g.ai is a decision tree (Kraken, Hub, Jumper). Beacon is not an on-ramp.",
  },
];

export function bridgeCatalogCard() {
  return {
    type: "bridge_catalog",
    title: "Bridge to 0G",
    summary: "Real venues. Beacon will not mark a bridge complete from a source tx it did not track on 0G.",
    routes: BRIDGE_CATALOG,
  };
}
