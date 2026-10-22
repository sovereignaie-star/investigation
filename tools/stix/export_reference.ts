/**
 * P4-014 — generate the frozen STIX reference bundle (deterministic, no hand).
 *
 * Runs the REAL exporter (`@ir/interop` stix module) on the reference case and
 * writes `fixtures/stix/reference-bundle.json`. The official validator's
 * blessing of this exact bundle is frozen by `tools/stix/validate_reference.py`
 * (its report references the bundle's sha256). CI proves the live export is
 * byte-identical to this frozen bundle (determinism + no drift).
 *
 * Usage: node --experimental-strip-types tools/stix/export_reference.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { stixExport } = (await import(
  // eslint-disable-next-line no-relative-import-paths -- tool path from the tools dir to the workspace package
  "../../packages/interop/src/stix/stix.ts"
)) as typeof import("../../packages/interop/src/stix/stix.ts");

const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "stix", "reference-case.json"), "utf8")) as {
  graph: Parameters<typeof stixExport>[0];
};

const EXPORT_TIMESTAMP = "2026-10-22T00:00:00.000Z";
const { bundle, skipped } = stixExport(referenceCase.graph, { timestamp: EXPORT_TIMESTAMP });
if (skipped.nodes.length > 0 || skipped.edges.length > 0) {
  console.error("unexpected skips in the reference case (it is fully mapped):", JSON.stringify(skipped));
  process.exit(1);
}
const out = join(root, "fixtures", "stix", "reference-bundle.json");
writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`wrote ${out} (${bundle.objects.length} objects)`);
