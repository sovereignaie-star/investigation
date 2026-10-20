/**
 * P3-016: the typed view contract of the eight result nodes. The legacy
 * renderers took `Record<string, unknown>` soup (the ROADMAP's own verdict: the
 * node «يخلط بيانات المجال والعرض؛ البيانات بلا مخطط») — this contract replaces
 * it: each node declares exactly the fields it renders, and the parse below is
 * fail-closed (invalid data yields null; the node renders an honest shell,
 * never a half-rendered node).
 *
 * The evidence rule of the new view model (P3-008): a node whose data carries
 * evidence references shows them — what is shown links to its evidence.
 * The data is VIEW data (the small editable canvas builds it); the projection's
 * GraphNode is the domain model and is not copied here.
 */

/** Every node may carry the evidence records backing what it shows. */
export interface EvidenceRefs {
  evidenceIds?: string[];
}

export interface DefaultNodeData extends EvidenceRefs {
  label: string;
  value: string;
  /** The identifier catalog type id (icon/name come from the live catalog). */
  identifierType: string;
}

export interface TextNodeData extends EvidenceRefs {
  label: string;
  value: string;
}

export interface LinkNodeData extends EvidenceRefs {
  label: string;
  url: string;
  domain?: string;
}

export interface FileNodeData extends EvidenceRefs {
  label: string;
  name?: string;
  /** Bytes. */
  size?: number;
  mime?: string;
  url?: string;
}

export interface ImageNodeData extends EvidenceRefs {
  label: string;
  src: string;
}

export interface VideoNodeData extends EvidenceRefs {
  label: string;
  url: string;
}

export interface MapNodeData extends EvidenceRefs {
  label: string;
  /** "lat,lng" (the catalog's geo_point shape). */
  geo?: string;
  city?: string;
  country?: string;
}

export interface LocationNodeData extends EvidenceRefs {
  label: string;
  loc?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
}

export type ResultNodeKind = "default" | "text" | "link" | "file" | "image" | "video" | "map" | "location";

/** The kind → data map: parseNodeData returns the node's own typed shape. */
export interface ResultNodeKinds {
  default: DefaultNodeData;
  text: TextNodeData;
  link: LinkNodeData;
  file: FileNodeData;
  image: ImageNodeData;
  video: VideoNodeData;
  map: MapNodeData;
  location: LocationNodeData;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const evidence = (r: Record<string, unknown>): EvidenceRefs => {
  const ids = r["evidenceIds"];
  return Array.isArray(ids) && ids.every((x): x is string => typeof x === "string") ? { evidenceIds: ids } : {};
};

/** Spreads an optional field only when present: `...only("domain", domain)`. */
function only(key: string, value: string | number | undefined): Record<string, string | number> {
  return value === undefined ? {} : { [key]: value };
}

/** Per-kind parsers: each returns the node's own typed shape or null. */
const PARSERS: { [K in ResultNodeKind]: (r: Record<string, unknown>, label: string) => ResultNodeKinds[K] | null } = {
  default: (r, label): DefaultNodeData | null => {
    const value = str(r["value"]);
    const identifierType = str(r["identifierType"]);
    if (value === undefined || identifierType === undefined) return null;
    return { label, value, identifierType, ...evidence(r) };
  },
  text: (r, label): TextNodeData | null => {
    const value = str(r["value"]);
    if (value === undefined) return null;
    return { label, value, ...evidence(r) };
  },
  link: (r, label): LinkNodeData | null => {
    const url = str(r["url"]);
    if (url === undefined) return null;
    return { label, url, ...only("domain", str(r["domain"])), ...evidence(r) };
  },
  file: (r, label): FileNodeData | null => ({
    label,
    ...only("name", str(r["name"])),
    ...only("size", num(r["size"])),
    ...only("mime", str(r["mime"])),
    ...only("url", str(r["url"])),
    ...evidence(r),
  }),
  image: (r, label): ImageNodeData | null => {
    const src = str(r["src"]);
    if (src === undefined) return null;
    return { label, src, ...evidence(r) };
  },
  video: (r, label): VideoNodeData | null => {
    const url = str(r["url"]);
    if (url === undefined) return null;
    return { label, url, ...evidence(r) };
  },
  map: (r, label): MapNodeData | null => ({
    label,
    ...only("geo", str(r["geo"])),
    ...only("city", str(r["city"])),
    ...only("country", str(r["country"])),
    ...evidence(r),
  }),
  location: (r, label): LocationNodeData | null => ({
    label,
    ...only("loc", str(r["loc"])),
    ...only("city", str(r["city"])),
    ...only("region", str(r["region"])),
    ...only("country", str(r["country"])),
    ...only("org", str(r["org"])),
    ...evidence(r),
  }),
};

/**
 * Validates raw node data against the declared contract (fail-closed): wrong
 * types or missing required fields yield null; unknown fields are dropped (a
 * node renders only what it declares). Returns the node's own typed shape.
 */
export function parseNodeData<K extends ResultNodeKind>(kind: K, raw: unknown): ResultNodeKinds[K] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const label = str(r["label"]);
  if (label === undefined) return null;
  // A kind outside the declared set is invalid data too — fail closed, never call a
  // parser that does not exist.
  const parser = (PARSERS as Record<string, ((r: Record<string, unknown>, label: string) => object | null) | undefined>)[kind];
  return parser ? (parser(r, label) as ResultNodeKinds[K] | null) : null;
}
