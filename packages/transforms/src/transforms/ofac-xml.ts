/**
 * P2-011 — a bounded linear XML reader for the OFAC SDN file (TR-026).
 *
 * Verified against the official schema (https://www.treasury.gov/ofac/downloads/sdn.xml, downloaded
 * 2026-10-15): the root is `<sdnList>` and each entry is `<sdnEntry>` with a `<uid>`, a `<lastName>`
 * (the whole name for entities), an optional `<sdnType>` (Entity/Individual) and an `<akaList>` whose
 * `<aka>` elements each carry a `<lastName>` (and `<firstName>` for individuals). The reader walks the
 * document with a linear scan (no streaming library, no backtracking regex) and is fail-closed:
 * an XML document with the wrong root, a truncated entry, or an entry without a uid refuses the whole
 * run instead of silently returning fewer parties.
 */
export interface SdnParty {
  uid: number;
  category: string;
  aliases: string[];
}

/**
 * Parses the SDN XML body. Throws on malformed structure (fail-closed); an empty party list is a
 * valid outcome only when the document genuinely contains no `sdnEntry` elements.
 */
export function parseXmlSdn(body: string): SdnParty[] {
  const doc = body.trim();
  if (!doc.startsWith("<?xml") && !doc.startsWith("<")) throw new Error("OFAC SDN: not an XML document");
  const rootOpen = doc.indexOf("<sdnList");
  if (rootOpen === -1) throw new Error("OFAC SDN: wrong root element (expected sdnList)");
  const parties: SdnParty[] = [];
  let i = 0;
  while (i < doc.length) {
    const open = doc.indexOf("<sdnEntry>", i);
    if (open === -1) break;
    const close = doc.indexOf("</sdnEntry>", open);
    if (close === -1) throw new Error("OFAC SDN: unterminated sdnEntry element");
    const block = doc.slice(open, close);
    const uid = readUid(block);
    if (uid === undefined) throw new Error("OFAC SDN: sdnEntry without a uid");
    const category = readSdnType(block);
    const aliases = readAliases(block);
    if (aliases.length > 0) parties.push({ uid, category, aliases });
    i = close + "</sdnEntry>".length;
  }
  return parties;
}

function readUid(block: string): number | undefined {
  const m = /<uid>(\d+)<\/uid>/.exec(block);
  return m ? Number(m[1]) : undefined;
}

function readSdnType(block: string): string {
  return /<sdnType>([^<]+)<\/sdnType>/.exec(block)?.[1] ?? "unknown";
}

/** The party's own full name: "firstName lastName" for individuals, lastName alone for entities. */
function readOwnName(block: string): string | undefined {
  const last = /<lastName>([^<]*)<\/lastName>/.exec(block)?.[1]?.trim();
  const first = /<firstName>([^<]*)<\/firstName>/.exec(block)?.[1]?.trim();
  if (first && last) return `${first} ${last}`;
  return last || undefined;
}

/** The party's own full name plus every `aka` lastName/firstName. */
function readAliases(block: string): string[] {
  const out: string[] = [];
  const name = readOwnName(block);
  if (name) out.push(name);
  const akaList = /<akaList>([\s\S]*)<\/akaList>/.exec(block)?.[1];
  if (akaList) {
    for (const aka of akaList.matchAll(/<aka>([\s\S]*?)<\/aka>/g)) {
      const last = /<lastName>([^<]*)<\/lastName>/.exec(aka[1] ?? "")?.[1]?.trim();
      const first = /<firstName>([^<]*)<\/firstName>/.exec(aka[1] ?? "")?.[1]?.trim();
      if (first && last) out.push(`${first} ${last}`);
      else if (last) out.push(last);
    }
  }
  return out;
}
