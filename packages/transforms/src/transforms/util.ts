/**
 * P2-009 — shared helpers for the first transform batch (TR-001..TR-010).
 *
 * Input validation is strict and fail-closed: a transform never sends a
 * malformed or unvalidated value to a provider (D-013, D-015). These helpers
 * are pure string checks — no network, no I/O.
 */

/** Normalize a domain: trim, lowercase, strip a trailing dot. */
export function normalizeDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (d.length === 0 || d.length > 253) throw new Error(`invalid domain: "${raw}"`);
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(d)) {
    throw new Error(`invalid domain: "${raw}"`);
  }
  return d;
}

/** Validate an IPv4 address (dotted quad). */
export function isIpv4(raw: string): boolean {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Validate an IPv6 address (loose structural check). */
export function isIpv6(raw: string): boolean {
  const s = raw.trim();
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s);
}

/** Validate an ASN (AS followed by 1-10 digits). */
export function isAsn(raw: string): boolean {
  return /^AS\d{1,10}$/i.test(raw.trim());
}

/** Validate a CIDR prefix (IPv4 form). */
export function isPrefix(raw: string): boolean {
  const m = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.exec(raw.trim());
  if (!m) return false;
  const [ip, bits] = raw.trim().split("/");
  return isIpv4(ip) && Number(bits) <= 32;
}

/** Parse a JSON body defensively; throws a clear error on malformed data. */
export function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`TR: malformed JSON from ${what}`);
  }
}
