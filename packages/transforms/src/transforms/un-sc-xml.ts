/**
 * P2-011 — a bounded linear XML reader for the UN SC Consolidated List (TR-027).
 *
 * Same contract as `ofac-xml.ts`: a linear scan, no streaming library, fail-closed on a malformed
 * structure (an unterminated party fails the whole run rather than silently returning fewer rows).
 * Only the fields TR-027 needs are read: referenceNumber, entityType and the party names.
 */
export interface UnParty {
  referenceNumber: string;
  entityType?: string;
  names: string[];
}

export function parseUnConsolidated(body: string): UnParty[] {
  const doc = body.trim();
  if (!doc.startsWith("<")) throw new Error("UN SC Consolidated List: not an XML document");
  const parties: UnParty[] = [];
  let i = 0;
  while (i < doc.length) {
    const indiv = doc.indexOf("<INDIVIDUAL>", i);
    const ent = doc.indexOf("<ENTITY>", i);
    const open = indiv === -1 ? ent : ent === -1 ? indiv : Math.min(indiv, ent);
    if (open === -1) break;
    const tag = doc.startsWith("<INDIVIDUAL>", open) ? "INDIVIDUAL" : "ENTITY";
    const close = doc.indexOf(`</${tag}>`, open);
    if (close === -1) throw new Error(`UN SC Consolidated List: unterminated ${tag} element`);
    const block = doc.slice(open, close);
    const ref = readReferenceNumber(block);
    if (!ref) throw new Error(`UN SC Consolidated List: ${tag} without a reference number`);
    const names = readNames(block);
    if (names.length > 0) {
      parties.push({ referenceNumber: ref, entityType: tag === "INDIVIDUAL" ? "individual" : "entity", names });
    }
    i = close + `</${tag}>`.length;
  }
  return parties;
}

function readReferenceNumber(block: string): string | undefined {
  return /<REFERENCE_NUMBER>([^<]+)<\/REFERENCE_NUMBER>/.exec(block)?.[1]?.trim();
}

/** The party's own `NAME` plus every alias. */
function readNames(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/<NAME>([^<]+)<\/NAME>/g)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  for (const m of block.matchAll(/<ALIAS_NAME>([^<]+)<\/ALIAS_NAME>/g)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}
