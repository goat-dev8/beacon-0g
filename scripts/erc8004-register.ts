import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { Interface, JsonRpcProvider, Wallet, getAddress, id } from "ethers";
import { ERC8004_IDENTITY, loadEnv, resetEnvCache } from "@beacon/shared";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
resetEnvCache();
const env = loadEnv();

const EXPLORER = env.ZEROG_EXPLORER.replace(/\/$/, "");
const identity = getAddress(env.ERC8004_IDENTITY || ERC8004_IDENTITY);

const CANDIDATES = [
  { name: "register()", iface: new Interface(["function register() returns (uint256)"]) },
  {
    name: "register(string)",
    iface: new Interface(["function register(string agentURI) returns (uint256)"]),
  },
  {
    name: "register(string,(string,bytes)[])",
    iface: new Interface([
      "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256)",
    ]),
  },
];

async function main() {
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK required");
  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const wallet = new Wallet(pk, provider);
  const code = await provider.getCode(identity);
  const proof: Record<string, unknown> = {
    identity,
    codeBytes: Math.max(0, (code.length - 2) / 2),
    checkedAt: new Date().toISOString(),
  };

  const agentUri = "https://github.com/goat-dev8/beacon-0g";
  let sent = false;
  for (const cand of CANDIDATES) {
    let data: string;
    try {
      if (cand.name === "register()") data = cand.iface.encodeFunctionData("register", []);
      else if (cand.name === "register(string)") data = cand.iface.encodeFunctionData("register", [agentUri]);
      else data = cand.iface.encodeFunctionData("register", [
        agentUri,
        [{ metadataKey: "agentWallet", metadataValue: wallet.address }],
      ]);
    } catch (err) {
      proof[cand.name] = { encode: err instanceof Error ? err.message : "encode failed" };
      continue;
    }
    try {
      await provider.call({ to: identity, from: wallet.address, data });
      const tx = await wallet.sendTransaction({ to: identity, data });
      await tx.wait();
      proof.register = {
        status: "REAL",
        selector: cand.name,
        tx: `${EXPLORER}/tx/${tx.hash}`,
      };
      sent = true;
      break;
    } catch (err) {
      proof[cand.name] = {
        status: "NOT_AVAILABLE",
        reason: err instanceof Error ? err.message.slice(0, 280) : "call failed",
        selector: id(cand.name).slice(0, 10),
      };
    }
  }
  if (!sent) {
    proof.register = {
      status: "NOT_AVAILABLE",
      reason: "No working register selector on 16661 Identity proxy. Dropped to P1. Not faked.",
    };
  }
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/erc8004.json");
  writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
