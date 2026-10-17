/**
 * P2-026 (owner decision 2026-10-17 — the adopted path-parameter proposal, ADR-30 style): the
 * path-template policy types and the standalone matcher. A provider whose endpoints carry the
 * SUBJECT in the request PATH (VirusTotal, GreyNoise, OTX, SecurityTrails) is declared as
 * template rows in the policy table (packages/egress/providers/post-policies.ts); the CENTRAL
 * gateway enforces them here — not each transform. One row per endpoint template: the pinned
 * provider + host + method are bound together, the template is a FULL path (no prefixes, no
 * wildcards), and every parameter is validated against a CLOSED type vocabulary with a declared
 * max length. Fail-closed: anything that does not match exactly is refused before DNS.
 *
 * The encoding contract (the review requirement): the RAW pathname is split on "/" BEFORE any
 * decoding; each parameter segment is then decoded EXACTLY ONCE and validated. A segment that
 * decodes to a slash, a double-encoded value, a malformed escape, a dot-segment, a backslash or
 * an empty string is a refusal — no closed type in this vocabulary ever accepts those shapes,
 * so traversal cannot pass through a parameter.
 */

/**
 * The closed vocabulary of path-parameter value types. There is deliberately NO free-form
 * "string": an indicator segment is a typed value (the review requirement), and each type has a
 * strict validator below. Adding a type is a policy-table review, not a transform decision.
 */
export type PathParamType =
  /** A dotted-quad IPv4 (octets 0-255). */
  | "ipv4"
  /** Colon-hex IPv6. */
  | "ipv6"
  /** Either IPv4 or IPv6 (VT's ip_addresses collection). */
  | "ip"
  /** A DNS name (domain or hostname) per RFC 1123 labels. */
  | "domain"
  /** A lowercase-or-uppercase hex hash of one of the declared lengths (md5/sha1/sha256). */
  | "hash"
  /**
   * VirusTotal's URL identifier: unpadded URL-safe base64 OR the 64-hex sha256 of the
   * canonicalized URL (the source documents both forms) — never a raw URL, never padding.
   */
  | "vtUrlId"
  /** A closed value list declared per row (e.g. SecurityTrails' dns record types). */
  | "enum";

/** One declared path parameter: name, closed type, declared max length, and the type's data. */
export interface PathParamSpec {
  readonly name: string;
  readonly type: PathParamType;
  /** The declared max length — OUR declared bound where the provider documents none. */
  readonly maxLength: number;
  /** For type "enum": the closed value list (compared lowercased — the source documents lowercase). */
  readonly values?: readonly string[];
  /** For type "hash": the accepted hex lengths (e.g. [32, 40, 64] for md5/sha1/sha256). */
  readonly lengths?: readonly number[];
}

/** One full path template: the literal segments with {name} placeholders, and its parameters. */
export interface PathParameterTemplate {
  /** The FULL path — "/api/v3/ip_addresses/{ip}". No prefix matching, no wildcards. */
  readonly template: string;
  readonly params: readonly PathParamSpec[];
}

/**
 * One path_parameter policy row (the owner's adopted proposal): provider + host + method bound
 * together, the endpoint templates, and the documentation record. Lives in the ADR-30 table file
 * next to the POST rows; the gateway enforces it centrally.
 */
export interface PathParameterPolicy {
  readonly provider: string;
  readonly host: string;
  readonly method: "GET";
  readonly templates: readonly PathParameterTemplate[];
  /** The parameter-by-parameter source in the provider's official docs (the review record). */
  readonly fieldsSource: string;
  /** The provider's contractual terms summary. */
  readonly terms: string;
}

export type PathMatchResult = { ok: true } | { ok: false; reason: string };

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/;
/** RFC 1123: labels of 1-63 alnum/hyphen chars, no leading/trailing hyphen; one or more labels. */
const DOMAIN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const HEX = /^[0-9a-fA-F]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function validIpv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  return value.split(".").every((o) => Number(o) <= 255);
}

/** One closed-type validator: returns the refusal reason, or undefined when the value is valid. */
type TypeValidator = (value: string, spec: PathParamSpec) => string | undefined;

/** The closed vocabulary as data — each type has exactly one strict validator. */
const TYPE_VALIDATORS: Record<PathParamType, TypeValidator> = {
  ipv4: (v) => (validIpv4(v) ? undefined : "is not a valid IPv4 address"),
  ipv6: (v) => (IPV6.test(v) ? undefined : "is not a valid IPv6 address"),
  ip: (v) => (validIpv4(v) || IPV6.test(v) ? undefined : "is not a valid IP address"),
  domain: (v) => (DOMAIN.test(v) ? undefined : "is not a valid DNS name (RFC 1123 labels)"),
  hash: (v, spec) => {
    const lengths = spec.lengths ?? [];
    return HEX.test(v) && lengths.includes(v.length)
      ? undefined
      : `is not a hex hash of the declared lengths (${lengths.join("/") || "none declared"})`;
  },
  vtUrlId: (v) =>
    BASE64URL.test(v) || (HEX.test(v) && v.length === 64) ? undefined : "is not a URL identifier (unpadded base64url or 64-hex sha256)",
  enum: (v, spec) => {
    const values = spec.values ?? [];
    return values.includes(v) ? undefined : `is not one of the declared values (${values.join("/") || "none declared"})`;
  },
};

/** The closed type validation: the length bounds, then the type's own validator. An unknown type
 *  in a row is a refusal, never a pass-through (the vocabulary is closed). */
function paramError(value: string, spec: PathParamSpec): string | undefined {
  if (value === "") return "is empty";
  if (value.length > spec.maxLength) {
    return `exceeds the declared max length ${spec.maxLength}`;
  }
  const validate = TYPE_VALIDATORS[spec.type];
  return validate === undefined ? "has an unknown declared type" : validate(value, spec);
}

/** Validate one decoded parameter value against its closed type. */
export function validatePathParam(value: string, spec: PathParamSpec): PathMatchResult {
  const err = paramError(value, spec);
  return err === undefined ? { ok: true } : { ok: false, reason: `parameter "${spec.name}" ${err}` };
}

/**
 * Match a RAW (undecoded) pathname against one template. The raw path is split on "/" first;
 * literal segments must match exactly (no decoding); each {name} segment is decoded exactly once
 * and validated. Segment counts must match exactly (a trailing slash or empty segment refuses).
 */
export function matchPathTemplate(rawPathname: string, tpl: PathParameterTemplate): PathMatchResult {
  const pathSegments = rawPathname.split("/");
  const tplSegments = tpl.template.split("/");
  if (pathSegments.length !== tplSegments.length) {
    return { ok: false, reason: "the path does not have the template's segment count" };
  }
  for (let i = 0; i < tplSegments.length; i += 1) {
    const tseg = tplSegments[i] ?? "";
    const raw = pathSegments[i] ?? "";
    const param = /^\{([a-zA-Z][a-zA-Z0-9_]*)\}$/.exec(tseg);
    if (param === null) {
      // A literal segment: exact equality on the RAW text (literals are plain ASCII).
      if (raw !== tseg) return { ok: false, reason: `segment ${i} does not match the template literal` };
      continue;
    }
    const name = param[1] ?? "";
    const spec = tpl.params.find((p) => p.name === name);
    if (spec === undefined) {
      return { ok: false, reason: `the template references parameter "${name}" with no declared spec` };
    }
    // Decode EXACTLY once. Malformed escapes refuse; encoded slashes are rejected by the closed
    // types (no type accepts "/" in its value), as are double-encoded shapes and empty segments.
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return { ok: false, reason: `parameter "${name}" is not a valid percent-encoded segment` };
    }
    const v = validatePathParam(decoded, spec);
    if (!v.ok) return v;
  }
  return { ok: true };
}
