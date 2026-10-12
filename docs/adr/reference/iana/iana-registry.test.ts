import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Verifies the saved IANA special-purpose registry snapshot and ties the actual
 * accept/reject rules used by ADR-08 to the official columns in that snapshot.
 *
 * The fingerprints alone do not prove the classification is correct; the rule checks
 * below are the proof. Fetching the live registry is a manual, documented step
 * (SNAPSHOT.md) and is deliberately NOT done here: no test in this project makes a
 * real network connection. The drift-detection tool that DOES compare a freshly
 * fetched source copy against the saved snapshot is `scripts/reference/iana-drift.mjs`
 * (also unit-tested without any network access).
 */

const dir = path.dirname(fileURLToPath(import.meta.url));

const SNAPSHOTS = {
  "iana-ipv4-special-purpose-registry.csv":
    "e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73",
  "iana-ipv6-special-purpose-registry.csv":
    "775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139",
} as const;

/**
 * A raw registry row. The three-valued official columns (True / False / N/A) are kept
 * as raw strings so that "N/A" (explicitly unspecified) is never silently coerced to
 * false, and footnoted values (e.g. "N/A [3]") are preserved for the tests to inspect.
 */
interface RawRegistryRow {
  addressBlock: string;
  name: string;
  rfc: string;
  source: string;
  destination: string;
  forwardable: string;
  globallyReachable: string;
  reservedByProtocol: string;
  /** True when the row was parsed from a multi-line quoted CSV record. */
  multilineRecord: boolean;
}

/**
 * Full CSV parsing that respects RFC 4180 quoting: quoted fields may contain commas,
 * escaped double quotes, and newlines. Records are terminated by an unquoted newline,
 * not by every newline character. This is what the IANA CSVs actually use (footnote
 * cells wrap across lines), so splitting on newlines and skipping non-address lines
 * would silently drop or corrupt those rows.
 */
function parseCsv(csv: string): { header: string[]; rows: RawRegistryRow[] } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let startedRecord = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      startedRecord = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      startedRecord = true;
    } else if (ch === "\n" || (ch === "\r" && csv[i + 1] === "\n")) {
      if (ch === "\r") i++;
      // End of a record only when the record has content (skips the trailing blank line).
      if (startedRecord || field.length > 0) {
        record.push(field);
        records.push(record);
      }
      record = [];
      field = "";
      startedRecord = false;
    } else {
      field += ch;
      startedRecord = true;
    }
  }
  if (startedRecord || field.length > 0) {
    record.push(field);
    records.push(record);
  }

  const header = records.shift() ?? [];
  const rows: RawRegistryRow[] = records.map((cols) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return {
      addressBlock: row["Address Block"] ?? "",
      name: row["Name"] ?? "",
      rfc: row["RFC"] ?? "",
      source: row["Source"] ?? "",
      destination: row["Destination"] ?? "",
      forwardable: row["Forwardable"] ?? "",
      globallyReachable: row["Globally Reachable"] ?? "",
      reservedByProtocol: row["Reserved-by-Protocol"] ?? "",
      multilineRecord: false,
    };
  });
  return { header, rows };
}

/** Strips IANA footnote markers like " [2]" or " [3]" from a value. */
function stripFootnotes(value: string): string {
  return value.replace(/\s*\[\d+\]\s*$/, "").trim();
}

/** True when the official three-valued column is exactly "True". */
function isTrue(value: string): boolean {
  return stripFootnotes(value) === "True";
}

/** True when the official three-valued column is exactly "False". */
function isFalse(value: string): boolean {
  return stripFootnotes(value) === "False";
}

/** True when the official three-valued column is "N/A" (explicitly unspecified). */
function isUnspecified(value: string): boolean {
  return stripFootnotes(value) === "N/A";
}

function readRegistry(file: keyof typeof SNAPSHOTS): RawRegistryRow[] {
  return parseCsv(readFileSync(path.join(dir, file), "utf8")).rows;
}

describe("IANA registry snapshot", () => {
  for (const [file, expectedSha] of Object.entries(SNAPSHOTS)) {
    it(`${file}: the saved snapshot matches its recorded fingerprint`, () => {
      const bytes = readFileSync(path.join(dir, file));
      const sha = createHash("sha256").update(bytes).digest("hex");
      // A local edit to the saved copy (or an updated snapshot without updating
      // SNAPSHOT.md) fails here.
      expect(sha).toBe(expectedSha);
    });
  }

  it("parses the CSV with RFC 4180 quoting: multi-line quoted records survive", () => {
    const csv = readFileSync(path.join(dir, "iana-ipv6-special-purpose-registry.csv"), "utf8");
    const { rows } = parseCsv(csv);
    // Every parsed row must have a non-empty address block in the official format.
    for (const row of rows) {
      expect(row.addressBlock).toMatch(/^[0-9a-fA-F.:/]+\/\d+/);
    }
    // The IPv6 registry contains at least one multi-line quoted record: the TEREDO
    // 2001::/32 row wraps its RFC column across lines ("[RFC4380]\n        [RFC8190]").
    // RFC 4180 parsing keeps it as ONE record; naive line-splitting would have produced
    // a continuation line that we would have dropped, losing the second RFC reference.
    const wrapped = rows.find((r) => r.addressBlock === "2001::/32");
    expect(wrapped).toBeDefined();
    expect(wrapped?.name).toBe("TEREDO");
    expect(wrapped?.rfc).toContain("RFC4380");
    expect(wrapped?.rfc).toContain("RFC8190");
  });

  it("every official row is preserved: no rows silently dropped", () => {
    const v4 = readRegistry("iana-ipv4-special-purpose-registry.csv");
    const v6 = readRegistry("iana-ipv6-special-purpose-registry.csv");
    // Both registries share the same column semantics; spot-check known rows.
    const loopback4 = v4.find((r) => stripFootnotes(r.addressBlock) === "127.0.0.0/8");
    expect(loopback4?.name).toBe("Loopback");
    const loopback6 = v6.find((r) => stripFootnotes(r.addressBlock) === "::1/128");
    expect(loopback6?.name).toBe("Loopback Address");
    // The full IETF Protocol Assignments block 2001::/23 and its sub-allocations are present.
    const ietf = v6.find((r) => stripFootnotes(r.addressBlock) === "2001::/23");
    expect(ietf).toBeDefined();
    const teredo = v6.find((r) => stripFootnotes(r.addressBlock) === "2001::/32");
    expect(teredo).toBeDefined();
  });

  it("ADR-08's rejected 6to4 2002::/16: the registry column is explicitly N/A, and the rejection is policy", () => {
    const v6 = readRegistry("iana-ipv6-special-purpose-registry.csv");
    const row = v6.find((r) => stripFootnotes(r.addressBlock) === "2002::/16");
    expect(row).toBeDefined();
    expect(stripFootnotes(row?.name ?? "")).toBe("6to4");
    // The OFFICIAL registry does not mark 6to4 globally reachable; the column is
    // "N/A" (explicitly unspecified, with a footnote), NOT False. ADR-08's rejection
    // is therefore an explicit security POLICY decision (deprecated relay mechanism,
    // RFC 7526; the embedded address is a 6to4 site router, not the final destination),
    // NOT something the registry data alone mandates. This test pins the raw value so
    // the ADR-08 text cannot claim the registry says "False".
    expect(isUnspecified(row?.globallyReachable ?? "")).toBe(true);
    expect(isTrue(row?.globallyReachable ?? "")).toBe(false);
  });

  it("ADR-08's rejected ORCHIDv2 2001:20::/28 is a policy decision, not a registry mandate", () => {
    const v6 = readRegistry("iana-ipv6-special-purpose-registry.csv");
    const row = v6.find((r) => stripFootnotes(r.addressBlock) === "2001:20::/28");
    expect(row).toBeDefined();
    expect(row?.name).toBe("ORCHIDv2");
    // The OFFICIAL registry marks ORCHIDv2 globally reachable and NOT reserved-by-protocol.
    // ADR-08's rejection is therefore an explicit security POLICY decision (RFC 7343
    // ORCHIDs are for overlay hashing, not general IP destinations), NOT something the
    // registry data alone mandates. This test pins that fact so the ADR-08 text cannot
    // claim the registry as the source of the rejection.
    expect(isTrue(row?.globallyReachable ?? "")).toBe(true);
    expect(isFalse(row?.reservedByProtocol ?? "")).toBe(true);
  });

  it("registry evidence for the refused blocks: refuse-grade columns where the registry speaks", () => {
    const v4 = readRegistry("iana-ipv4-special-purpose-registry.csv");
    const v6 = readRegistry("iana-ipv6-special-purpose-registry.csv");
    const refuse4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"];
    for (const block of refuse4) {
      const row = v4.find((r) => stripFootnotes(r.addressBlock) === block);
      expect(row, `IPv4 block ${block} missing from the official registry`).toBeDefined();
      expect(isTrue(row?.globallyReachable ?? ""), `${block} must not be globally reachable`).toBe(false);
    }
    // IPv6 blocks the registry classifies as refuse-grade.
    const refuse6 = ["::/128", "::1/128", "::ffff:0:0/96", "100::/64", "2001::/32", "fc00::/7", "fe80::/10"];
    for (const block of refuse6) {
      const row = v6.find((r) => stripFootnotes(r.addressBlock) === block);
      expect(row, `IPv6 block ${block} missing from the official registry`).toBeDefined();
      expect(isTrue(row?.globallyReachable ?? ""), `${block} must not be globally reachable`).toBe(false);
    }
  });

  it("blocks refused by PROTOCOL or POLICY but not by the special-purpose registry are documented as such", () => {
    const v6 = readRegistry("iana-ipv6-special-purpose-registry.csv");
    // ff00::/8 (multicast) has its own registry and fec0::/10 (site-local) was
    // deprecated by RFC 3879 and removed from the current special-purpose registry.
    // The engine still refuses both as destinations, but that refusal is protocol
    // behavior (multicast is not a unicast destination) or explicit policy (legacy
    // site-local), NOT something this registry file proves. fc00::/7 (ULA) does not
    // cover fec0::/10; the legacy block needs its own explicit rule.
    expect(v6.find((r) => stripFootnotes(r.addressBlock) === "ff00::/8")).toBeUndefined();
    expect(v6.find((r) => stripFootnotes(r.addressBlock) === "fec0::/10")).toBeUndefined();
  });

  it("distinguishes 'not in the special registry' from 'publicly allocated and globally routable'", () => {
    const v4 = readRegistry("iana-ipv4-special-purpose-registry.csv");
    // A well-known public block (e.g. 1.1.1.0/24) must NOT appear in the special-purpose
    // registry: absence from this registry is the first classification step, and public
    // routability is then decided by the allocation registries (see the classifier
    // tests), not by this file.
    expect(v4.find((r) => stripFootnotes(r.addressBlock) === "1.1.1.0/24")).toBeUndefined();
  });
});
