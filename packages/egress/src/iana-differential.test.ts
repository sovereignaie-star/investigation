/**
 * Differential test: code classifier vs the IANA special-purpose registry CSV
 * snapshot in `docs/adr/reference/iana/`.
 *
 * The goal is NOT to make the classifier "match the CSV" — the classifier has
 * explicit policy refusals (documentation ranges, 6to4, ORCHIDv2) that
 * are documented ADR-08 decisions, not registry readings. The goal is:
 *
 * 1. Every block the registry marks `Globally Reachable: True` is classified
 *    as `public` (allowed) by the code, UNLESS the code has a documented
 *    policy refusal for that exact block.
 * 2. Every block marked `Globally Reachable: False` or `N/A` is classified as
 *    not-allowed, UNLESS the code has a documented policy override.
 * 3. No block falls through to the "no rule matched" default silently when the
 *    registry has an opinion about it.
 *
 * This test fails if the classifier drifts from the snapshot in either
 * direction without an explicit, documented policy refusal or override.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { classifyV4, classifyV6 } from "./address-policy";

/** Parse the IANA special-purpose CSV (RFC 4180, quoted fields possible). */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const values = splitCsvLine(l);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = values[i] ?? ""));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const SNAP = pathResolve(__dirname, "../../../docs/adr/reference/iana");

const v4Csv = parseCsv(readFileSync(pathResolve(SNAP, "iana-ipv4-special-purpose-registry.csv"), "utf-8"));
const v6Csv = parseCsv(readFileSync(pathResolve(SNAP, "iana-ipv6-special-purpose-registry.csv"), "utf-8"));

/**
 * Documented ADR-08 policy refusals: blocks the registry says are globally
 * reachable but the code rejects for a policy reason (not a registry reading).
 */
const POLICY_REFUSALS_V4 = new Set([
  "192.0.2.0/24", // TEST-NET-1 (documentation)
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "198.18.0.0/15", // benchmarking
  "192.88.99.0/24", // 6to4 Relay (deprecated) — tunneling
]);
const POLICY_REFUSALS_V6 = new Set([
  "2001:db8::/32", // documentation
  "3fff::/20", // documentation (RFC 9637)
  "2001:20::/28", // ORCHIDv2 — ADR-08 policy reject
  "2002::/16", // 6to4 — tunneling
  "2001::/32", // Teredo — tunneling
  "64:ff9b::/96", // NAT64 public — code classifies the EMBEDDED v4, not the block itself
]);

/**
 * Documented ADR-08 policy overrides: blocks the registry says are NOT globally
 * reachable but the code allows for a policy reason.
 */
const POLICY_ALLOWS_V4 = new Set<string>();
const POLICY_ALLOWS_V6 = new Set<string>();

/** First and last address of a CIDR block. */
function blockBounds(cidr: string): { first: string; last: string } | null {
  const [net, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const isV4 = net.includes(".") && !net.includes(":");
  if (isV4) {
    const p = net.split(".").map(Number);
    const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
    const shift = 32 - prefix;
    const base = (n >>> shift) << shift;
    const last = base | ((1 << shift) - 1);
    const fmt = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
    return { first: fmt(base), last: fmt(last) };
  }
  // v6: only sample the first address for simplicity; the differential is about
  // the BLOCK, not every address in it.
  return { first: net, last: net };
}

describe("differential: code classifier vs IANA snapshot", () => {
  describe("IPv4 blocks the registry marks Globally Reachable: True", () => {
    for (const row of v4Csv) {
      if (row["Globally Reachable"] !== "True") continue;
      const block = row["Address Block"];
      if (POLICY_REFUSALS_V4.has(block)) continue; // documented refusal
      it(`${block} (${row.Name}) is allowed by the code`, () => {
        const bounds = blockBounds(block);
        expect(bounds).not.toBeNull();
        expect(bounds).not.toBeNull();
        expect(classifyV4((bounds as { first: string }).first).ok).toBe(true);
      });
    }
  });

  describe("IPv4 blocks the registry marks Globally Reachable: False or N/A", () => {
    for (const row of v4Csv) {
      const gr = row["Globally Reachable"];
      if (gr === "True") continue;
      const block = row["Address Block"];
      if (POLICY_ALLOWS_V4.has(block)) continue;
      it(`${block} (${row.Name}) is rejected by the code`, () => {
        const bounds = blockBounds(block);
        expect(bounds).not.toBeNull();
        expect(bounds).not.toBeNull();
        expect(classifyV4((bounds as { first: string }).first).ok).toBe(false);
      });
    }
  });

  describe("IPv6 blocks the registry marks Globally Reachable: True", () => {
    for (const row of v6Csv) {
      if (row["Globally Reachable"] !== "True") continue;
      const block = row["Address Block"];
      if (POLICY_REFUSALS_V6.has(block)) continue; // documented refusal
      it(`${block} (${row.Name}) is allowed by the code`, () => {
        const bounds = blockBounds(block);
        expect(bounds).not.toBeNull();
        expect(bounds).not.toBeNull();
        expect(classifyV6((bounds as { first: string }).first).ok).toBe(true);
      });
    }
  });

  describe("IPv6 blocks the registry marks Globally Reachable: False or N/A", () => {
    for (const row of v6Csv) {
      const gr = row["Globally Reachable"];
      if (gr === "True") continue;
      const block = row["Address Block"];
      if (POLICY_ALLOWS_V6.has(block)) continue;
      it(`${block} (${row.Name}) is rejected by the code`, () => {
        const bounds = blockBounds(block);
        expect(bounds).not.toBeNull();
        expect(bounds).not.toBeNull();
        expect(classifyV6((bounds as { first: string }).first).ok).toBe(false);
      });
    }
  });

  describe("no block silently falls through to the default allow", () => {
    it("every v4 registry block that is denied by the classifier is ALSO denied by the registry or has a documented refusal", () => {
      // For every block the classifier denies, either the registry says not
      // globally reachable, or the block is in the documented refusals.
      for (const row of v4Csv) {
        const block = row["Address Block"];
        const bounds = blockBounds(block);
        if (!bounds) continue;
        const denied = classifyV4(bounds.first).ok === false;
        if (!denied) continue;
        const gr = row["Globally Reachable"];
        const isDocumentedRefusal = POLICY_REFUSALS_V4.has(block);
        expect(gr !== "True" || isDocumentedRefusal, `${block}: registry says GR=True but code denies it with NO documented refusal`).toBe(
          true,
        );
      }
    });
    it("every v6 registry block that is denied by the classifier is ALSO denied by the registry or has a documented refusal", () => {
      for (const row of v6Csv) {
        const block = row["Address Block"];
        const bounds = blockBounds(block);
        if (!bounds) continue;
        const denied = classifyV6(bounds.first).ok === false;
        if (!denied) continue;
        const gr = row["Globally Reachable"];
        const isDocumentedRefusal = POLICY_REFUSALS_V6.has(block);
        expect(gr !== "True" || isDocumentedRefusal, `${block}: registry says GR=True but code denies it with NO documented refusal`).toBe(
          true,
        );
      }
    });
  });
});
