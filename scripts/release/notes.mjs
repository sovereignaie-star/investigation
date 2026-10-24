#!/usr/bin/env node
/**
 * P7-001: extract the release notes for a version from CHANGELOG.md.
 * Usage: node scripts/release/notes.mjs v0.1.0   (or 0.1.0)
 * Prints the markdown section for that version (between its heading and the
 * next version heading) — consumed by .github/workflows/release.yml.
 */
import { readFileSync } from "node:fs";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: notes.mjs <vX.Y.Z | X.Y.Z>");
  process.exit(1);
}
const version = arg.replace(/^v/, "");
const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## ${version}`));
if (start === -1) {
  console.error(`no CHANGELOG section for ${version}`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && /^## \d/.test(l));
console.log(
  lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim(),
);
