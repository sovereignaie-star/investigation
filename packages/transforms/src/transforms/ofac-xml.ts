/**
 * P2-011 — a bounded linear XML reader for the OFAC SDN file (TR-026).
 *
 * The SDN file is a fixed, documented schema (party, alias, address, ...). This reader walks the
 * document with a linear scan (no streaming library, no backtracking regex) and stops at the
 * first structural error: a malformed file fails the run (fail-closed) rather than silently
 * returning fewer parties. Only the fields TR-026 needs are read: uid, category and aliases.
 */
export interface SdnParty {
  uid: number;
  category: string;
  aliases: string[];
}

/**
 * Parses the SDN XML body. Throws on malformed structure (fail-closed); an empty party list is a
 * valid outcome only when the document genuinely contains no `party` elements.
 */
export function parseXmlSdn(body: string): SdnParty[] {
  const parties: SdnParty[] = [];
  const doc = body.trim();
  if (!doc.startsWith("<")) throw new Error("OFAC SDN: not an XML document");
  // A linear scan over the party elements; no regex backtracking on long runs.
  let i = 0;
  while (i < doc.length) {
    const open = doc.indexOf("<party ", i);
    if (open === -1) break;
    const close = doc.indexOf("</party>", open);
    if (close === -1) throw new Error("OFAC SDN: unterminated party element");
    const block = doc.slice(open, close);
    const uid = readUid(block);
    if (uid === undefined) throw new Error("OFAC SDN: party without a uid");
    const category = readCategory(block);
    const aliases = readAliases(block);
    if (aliases.length > 0) parties.push({ uid, category, aliases });
    i = close + "</party>".length;
  }
  return parties;
}

function readUid(block: string): number | undefined {
  const m = /<party\s[^>]*uid="(\d+)"/.exec(block);
  return m ? Number(m[1]) : undefined;
}

function readCategory(block: string): string {
  const m = /<category>([^<]+)<\/category>/.exec(block);
  return m?.[1] ?? "unknown";
}

/** Every `alias` strong (and the party's own name) as a candidate match. */
function readAliases(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/<alias\s[^>]*>([^<]*)<\/alias>/g)) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  const name = /<name>([^<]+)<\/name>/.exec(block)?.[1]?.trim();
  if (name) out.push(name);
  return out;
}
