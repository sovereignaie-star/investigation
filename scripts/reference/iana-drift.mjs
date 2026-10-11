#!/usr/bin/env node
/**
 * IANA registry drift detection (P2-003, T-SEC-SSRF-045 support).
 *
 * Compares a freshly fetched copy of each IANA special-purpose registry against the
 * snapshot saved in `docs/adr/reference/iana/`. Exit 0 = no drift; exit 1 = drift
 * (or a fetch error, which is also a "cannot verify" outcome and fails closed).
 *
 * Usage (manual, deliberately not wired into CI so that no CI check makes a network
 * connection): node scripts/reference/iana-drift.mjs --ipv4 <path> --ipv6 <path>
 * The paths point to freshly downloaded CSVs. With no arguments the script prints
 * the exact curl commands to fetch them, so the refresh procedure is reproducible.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snapshotDir = path.join(repoRoot, "docs/adr/reference/iana");

const REGISTRIES = [
  {
    key: "ipv4",
    file: "iana-ipv4-special-purpose-registry.csv",
    url: "https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv",
  },
  {
    key: "ipv6",
    file: "iana-ipv6-special-purpose-registry.csv",
    url: "https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv",
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ipv4") out.ipv4 = argv[++i];
    else if (argv[i] === "--ipv6") out.ipv6 = argv[++i];
  }
  return out;
}

const parsed = args();

if (!parsed.ipv4 && !parsed.ipv6) {
  console.error("No freshly fetched copies provided. Fetch them with:");
  for (const r of REGISTRIES) console.error(`  curl -o <${r.key}.csv> ${r.url}`);
  console.error("Then run: node scripts/reference/iana-drift.mjs --ipv4 <ipv4.csv> --ipv6 <ipv6.csv>");
  process.exit(1);
}

let drifted = false;
for (const r of REGISTRIES) {
  const fetchedPath = parsed[r.key];
  if (!fetchedPath) {
    console.error(`${r.key}: no fetched copy provided; cannot verify.`);
    drifted = true;
    continue;
  }
  const savedPath = path.join(snapshotDir, r.file);
  let saved, fetched;
  try {
    saved = readFileSync(savedPath);
  } catch {
    console.error(`${r.key}: saved snapshot missing at ${savedPath}.`);
    drifted = true;
    continue;
  }
  try {
    fetched = readFileSync(fetchedPath);
  } catch (e) {
    console.error(`${r.key}: cannot read fetched copy ${fetchedPath}: ${e.message}`);
    drifted = true;
    continue;
  }
  const savedSha = sha256(saved);
  const fetchedSha = sha256(fetched);
  if (savedSha === fetchedSha) {
    console.log(`${r.key}: OK (sha256 ${savedSha})`);
  } else {
    drifted = true;
    console.error(`${r.key}: DRIFT`);
    console.error(`  saved   sha256 ${savedSha}`);
    console.error(`  fetched sha256 ${fetchedSha}`);
    console.error("  The saved snapshot is the review baseline; a drift means IANA updated the");
    console.error("  registry and the ADR-08 snapshot must be refreshed and re-reviewed (D-8).");
  }
}
process.exit(drifted ? 1 : 0);
