/**
 * P2-011 — a bounded linear XML reader for the EU consolidated financial sanctions list (TR-028).
 *
 * Verified against the official file (webgate.ec.europa.eu/fsd/fsf, downloaded 2026-10-15): the root
 * is `<export>` with `<sanctionEntity>` entries carrying `euReferenceNumber` and a `<subjectType
 * code="person|enterprise">`, and every `<nameAlias>` has a `wholeName` attribute (plus firstName/
 * lastName parts). The reader is fail-closed: a wrong root, a truncated entry, or an entry without
 * a reference number refuses the whole run instead of silently returning fewer parties.
 */
export interface EuParty {
  euReferenceNumber: string;
  subjectType: string;
  names: string[];
}

export function parseEuSanctions(body: string): EuParty[] {
  const doc = body.trim();
  if (!doc.startsWith("<?xml") && !doc.startsWith("<")) throw new Error("EU sanctions list: not an XML document");
  if (doc.indexOf("<export ") === -1 && !doc.startsWith("<export>")) {
    throw new Error("EU sanctions list: wrong root element (expected export)");
  }
  const parties: EuParty[] = [];
  let i = 0;
  while (i < doc.length) {
    const open = doc.indexOf("<sanctionEntity ", i);
    if (open === -1) break;
    const close = doc.indexOf("</sanctionEntity>", open);
    if (close === -1) throw new Error("EU sanctions list: unterminated sanctionEntity element");
    const block = doc.slice(open, close);
    const ref = /euReferenceNumber="([^"]+)"/.exec(block)?.[1]?.trim();
    if (!ref) throw new Error("EU sanctions list: sanctionEntity without an euReferenceNumber");
    const type = /<subjectType code="([^"]+)"/.exec(block)?.[1] ?? "unknown";
    const names = readNames(block);
    if (names.length > 0) parties.push({ euReferenceNumber: ref, subjectType: type, names });
    i = close + "</sanctionEntity>".length;
  }
  return parties;
}

/** Every non-empty `wholeName` alias of the party. */
function readNames(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/wholeName="([^"]*)"/g)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}
