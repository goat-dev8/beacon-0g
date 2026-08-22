import { JsonRpcProvider, Wallet } from "ethers";
import {
  AppError,
  loadEnv,
  ZEROG_INFERENCE,
  ZEROG_LEDGER,
  type BeaconEnv,
} from "@beacon/shared";
import type { ComputeBroker } from "./types.js";

export async function createComputeBroker(env: BeaconEnv = loadEnv()): Promise<ComputeBroker> {
  const pk = env.SETTLER_PRIVATE_KEY || env.ZEROG_DEPLOYER_PK;
  if (!pk) {
    throw new AppError("COMPUTE_FAILED", {
      message: "SETTLER_PRIVATE_KEY or ZEROG_DEPLOYER_PK is required to open the 0G Compute ledger.",
    });
  }
  let create: ((
    signer: Wallet,
    ledgerCA?: string,
    inferenceCA?: string,
  ) => Promise<ComputeBroker>) | undefined;
  try {
    const mod = (await import("@0gfoundation/0g-compute-ts-sdk")) as unknown as {
      createZGComputeNetworkBroker?: typeof create;
    };
    create = mod.createZGComputeNetworkBroker;
  } catch (cause) {
    throw new AppError("COMPUTE_FAILED", {
      message: "Could not import @0gfoundation/0g-compute-ts-sdk. Install 0.9.0.",
      cause,
    });
  }
  if (!create) {
    throw new AppError("COMPUTE_FAILED", {
      message: "createZGComputeNetworkBroker is missing from the 0G Compute SDK.",
    });
  }
  const provider = new JsonRpcProvider(env.ZEROG_RPC_URL, env.CHAIN_ID);
  const wallet = new Wallet(pk, provider);
  return create(wallet, env.ZEROG_LEDGER || ZEROG_LEDGER, env.ZEROG_INFERENCE || ZEROG_INFERENCE);
}
