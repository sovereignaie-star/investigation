/**
 * P4-015 — generate the frozen format reference artifacts (deterministic, no hand).
 *
 * Runs the REAL exporters on the reference case and writes:
 * - fixtures/formats/reference.gexf / reference.graphml / reference.prov.json
 * The official XSD/prov blessings of these exact artifacts are frozen by
 * `tools/formats/validate_reference.py` (its report references their sha256).
 *
 * Usage: node --experimental-strip-types tools/formats/export_reference.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { gexfExport } =
  (await import("../../packages/interop/src/formats/gexf.ts")) as typeof import("../../packages/interop/src/formats/gexf.ts");
const { graphmlExport } =
  (await import("../../packages/interop/src/formats/graphml.ts")) as typeof import("../../packages/interop/src/formats/graphml.ts");
const { provExport } =
  (await import("../../packages/interop/src/formats/prov.ts")) as typeof import("../../packages/interop/src/formats/prov.ts");

const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "formats", "reference-case.json"), "utf8")) as {
  graph: Parameters<typeof gexfExport>[0];
  ledger: Parameters<typeof provExport>[0];
};

const out = (name: string): string => join(root, "fixtures", "formats", name);
writeFileSync(out("reference.gexf"), gexfExport(referenceCase.graph), "utf8");
writeFileSync(out("reference.graphml"), graphmlExport(referenceCase.graph), "utf8");
writeFileSync(out("reference.prov.json"), JSON.stringify(provExport(referenceCase.ledger), null, 2) + "\n", "utf8");
console.log("wrote reference.gexf, reference.graphml, reference.prov.json");
