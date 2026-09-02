#!/usr/bin/env node
/**
 * Fail CI if banned fallbacks / mock rails leak into the 0G tree.
 * Needles are assembled at runtime so this file itself is not a match.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sol",
  ".toml",
  ".css",
  ".html",
]);

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "out",
  "cache",
  "broadcast",
  ".git",
  "coverage",
  "lib",
]);

const GLOBAL_NEEDLES = [
  ["GROQ", "API", "KEY"].join("_"),
  "InMemoryStorage",
  ["SIMULATED", "TEE"].join("_"),
  ["api", "openai", "com"].join("."),
  "Pollinations",
  "ComfyUI",
  "MockUSDC",
];

const SWAP_NEEDLE = ["0x9bdcA", "579"].join("");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (TEXT_EXT.has(extname(name))) acc.push(full);
  }
  return acc;
}

function scan() {
  const failures = [];
  const files = walk(ROOT).filter((f) => {
    const rel = relative(ROOT, f).replaceAll("\\", "/");
    if (rel === "scripts/guard-fallbacks.mjs") return false;
    if (rel.startsWith("0g/") || rel.includes("/research/")) return false;
    return (
      rel.startsWith("packages/") ||
      rel.startsWith("apps/") ||
      rel.startsWith("services/") ||
      rel.startsWith("scripts/") ||
      rel.startsWith(".github/") ||
      rel === "README.md" ||
      rel === "package.json"
    );
  });

  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    for (const needle of GLOBAL_NEEDLES) {
      if (text.includes(needle)) {
        failures.push(`${rel} contains banned token ${needle}`);
      }
    }
    if (rel.startsWith("packages/swap/") && text.includes(SWAP_NEEDLE)) {
      failures.push(`${rel} contains banned swap venue ${SWAP_NEEDLE}`);
    }
  }

  if (failures.length > 0) {
    console.error("guard-fallbacks failed:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`guard-fallbacks ok (${files.length} files)`);
}

scan();
