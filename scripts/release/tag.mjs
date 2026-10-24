#!/usr/bin/env node
/**
 * P7-001: print (and optionally create) the release tag for the current
 * package.json version. Usage: node scripts/release/tag.mjs [--create]
 * The tag always matches semver exactly — a 0.0.0 workspace has no tag.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
if (pkg.version === "0.0.0") {
  console.error("workspace version is 0.0.0 — set a real semver before tagging");
  process.exit(1);
}
const tag = `v${pkg.version}`;
const existing = execSync("git tag --list", { encoding: "utf8" }).split("\n");
if (existing.includes(tag)) {
  console.log(`${tag} already exists — delete it first if this is a re-release`);
  process.exit(1);
}
if (process.argv.includes("--create")) {
  execSync(`git tag -a ${tag} -m "release ${tag}"`, { stdio: "inherit" });
  console.log(`${tag} created — push it with: git push origin ${tag}`);
} else {
  console.log(tag);
}
