/** Strict IP literal validation (RFC 791 dotted-quad without leading zeros, RFC 4291 section 2.2 text forms). */

export function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => /^(?:0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

export function isIPv6(s: string): boolean {
  if (s.length > 45 || s.includes("%")) return false; // zone identifiers are link-local syntax, not addresses
  let groups = s;
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".", lastColon)) {
    if (!isIPv4(s.slice(lastColon + 1))) return false;
    groups = `${s.slice(0, lastColon + 1)}0:0`; // the embedded IPv4 occupies two 16-bit groups
  }
  const halves = groups.split("::");
  if (halves.length > 2) return false;
  const hex = /^[0-9a-fA-F]{1,4}$/;
  const parse = (h: string) => (h === "" ? [] : h.split(":"));
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (![...head, ...tail].every((g) => hex.test(g))) return false;
  const n = head.length + tail.length;
  return halves.length === 2 ? n <= 7 : n === 8;
}

export const isIP = (s: string): 0 | 4 | 6 => (isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0);
