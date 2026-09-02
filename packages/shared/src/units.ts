import { NEURONS_PER_0G } from "./constants.js";

/** Parse a decimal 0G amount (e.g. "0.001", "0.2 0G") to wei (1e18). */
export function parse0g(amount: string | number): bigint {
  const raw = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!raw) return 0n;
  const neg = raw.startsWith("-");
  const unsigned = (neg ? raw.slice(1) : raw)
    .replace(/^\$/, "")
    .replace(/\s*0G\s*$/i, "")
    .trim();
  const [wholePart, fracPart = ""] = unsigned.split(".");
  const whole = BigInt(wholePart || "0");
  const fracPadded = (fracPart + "0".repeat(18)).slice(0, 18);
  const frac = BigInt(fracPadded);
  const wei = whole * NEURONS_PER_0G + frac;
  return neg ? -wei : wei;
}

export function format0g(wei: bigint, digits = 6): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / NEURONS_PER_0G;
  const frac = abs % NEURONS_PER_0G;
  const fracStr = frac.toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
  return `${neg ? "-" : ""}${body} 0G`;
}

export function neuronsTo0gWei(neurons: bigint): bigint {
  return neurons;
}

export function parseNeuronString(value: string | number | bigint | undefined | null): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  if (!/^-?\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

export function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new Error("division by zero");
  return (a * b) / denom;
}

export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  return (a + b - 1n) / b;
}
