/**
 * P2-011 — a bounded linear XML reader for the UN SC Consolidated List (TR-027).
 *
 * Verified against the official schema (https://scsanctions.un.org/…, the per-regime files that make up
 * the consolidated list; downloaded 2026-10-15): the root is `<CONSOLIDATED_LIST>` with `<INDIVIDUALS>`
 * and `<ENTITIES>` sections. Each `<INDIVIDUAL>` has `<FIRST_NAME>`..`<FOURTH_NAME>` name parts and a
 * `<REFERENCE_NUMBER>` (CTi/QDi. style); each `<ENTITY>` puts the whole name in `<FIRST_NAME>`. Aliases
 * live in `<INDIVIDUAL_ALIAS>/<ENTITY_ALIAS>` blocks with an `<ALIAS_NAME>`. The reader is fail-closed:
 * a wrong root, a truncated entry, or an entry without a reference number refuses the whole run instead
 * of silently returning fewer parties.
 */
export interface UnParty {
  referenceNumber: string;
  entityType?: string;
  names: string[];
}

export function parseUnConsolidated(body: string): UnParty[] {
  const doc = body.trim();
  if (!doc.startsWith("<?xml") && !doc.startsWith("<")) throw new Error("UN SC Consolidated List: not an XML document");
  if (doc.indexOf("<CONSOLIDATED_LIST") === -1) throw new Error("UN SC Consolidated List: wrong root element");
  const parties: UnParty[] = [];
  for (const [tag, type] of [
    ["INDIVIDUAL", "individual"],
    ["ENTITY", "entity"],
  ] as const) {
    let i = 0;
    while (i < doc.length) {
      const open = doc.indexOf(`<${tag}>`, i);
      if (open === -1) break;
      const close = doc.indexOf(`</${tag}>`, open);
      if (close === -1) throw new Error(`UN SC Consolidated List: unterminated ${tag} element`);
      const block = doc.slice(open, close);
      const ref = /<REFERENCE_NUMBER>([^<]+)<\/REFERENCE_NUMBER>/.exec(block)?.[1]?.trim();
      if (!ref) throw new Error(`UN SC Consolidated List: ${tag} without a reference number`);
      const names = readNames(block, tag);
      if (names.length > 0) parties.push({ referenceNumber: ref, entityType: type, names });
      i = close + `</${tag}>`.length;
    }
  }
  return parties;
}

/**
 * The party's own name: the FIRST_NAME..FOURTH_NAME parts joined for individuals, the whole
 * FIRST_NAME for entities; plus every alias's ALIAS_NAME.
 */
function readNames(block: string, tag: string): string[] {
  const out: string[] = [];
  if (tag === "INDIVIDUAL") {
    const parts = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]
      .map((k) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(block)?.[1]?.trim())
      .filter((v): v is string => Boolean(v));
    if (parts.length > 0) out.push(parts.join(" "));
  } else {
    const name = /<FIRST_NAME>([^<]*)<\/FIRST_NAME>/.exec(block)?.[1]?.trim();
    if (name) out.push(name);
  }
  for (const m of block.matchAll(/<ALIAS_NAME>([^<]*)<\/ALIAS_NAME>/g)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}
