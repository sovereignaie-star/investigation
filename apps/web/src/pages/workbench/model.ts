import { specById, type Extracted } from "@ir/core/identifiers";

/**
 * P3-004 (UC-02) view model: map the engine's extraction results to display rows — one row per
 * unique identifier (best candidate wins on duplicates), classified with the catalog's Arabic
 * label and carrying the detector's confidence and validation verdict. View state only: nothing
 * here persists (D-033) or talks to the network.
 */

export interface IdentifierRow {
  /** Stable key: `${typeId}:${value}`. */
  id: string;
  value: string;
  typeId: string;
  typeLabelAr: string;
  category: string;
  /** Detector score, 0..1. */
  confidence: number;
  /** Checksum/registry/PSL verdict for the winning candidate, when the spec defines one. */
  validated: boolean;
}

export function toIdentifierRows(extracted: readonly Extracted[]): IdentifierRow[] {
  const byId = new Map<string, IdentifierRow>();
  for (const e of extracted) {
    const spec = specById(e.best.type);
    const row: IdentifierRow = {
      id: `${e.best.type}:${e.value}`,
      value: e.value,
      typeId: e.best.type,
      typeLabelAr: spec?.labels.ar ?? e.best.type,
      category: spec?.category ?? "—",
      confidence: e.best.score,
      validated: e.best.validated === true,
    };
    const prev = byId.get(row.id);
    if (prev === undefined || row.confidence > prev.confidence) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Toggle one identifier in the selection without mutating the input set. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
