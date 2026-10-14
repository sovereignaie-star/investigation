/**
 * robots.txt (RFC 9309) for page-fetching transforms in the public mode (ADR-08 section 6, owner decision C:
 * "respect robots.txt in TR-010 and TR-042"). Pure: parsing and matching only; fetching goes through the gateway
 * like any other request (the caller does it, see packages/cli/src/network.ts).
 *
 * Implemented as RFC 9309 specifies:
 * - groups start at `user-agent` lines; consecutive `user-agent` lines share one group; a crawler uses every group
 *   whose token matches its product token (case-insensitive), else the `*` groups, else no rule (allowed);
 * - `allow` / `disallow` with `*` (any sequence) and a trailing `$` (end); the longest matching pattern wins and
 *   `allow` wins a tie; an empty `disallow` is no rule; `/robots.txt` itself is always allowed;
 * - the status of the robots.txt fetch decides when there is no file to parse: 2xx parse, 4xx allow all,
 *   5xx / unreachable disallow all ("complete disallow" until it can be fetched);
 * - only the first 500 KiB are parsed (RFC 9309 section 2.5).
 * Paths are compared percent-encoded, with the query (RFC 9309 section 2.2.2).
 */
export const ROBOTS_PRODUCT_TOKEN = "InvestigationRoom";
/** Tokens a robots.txt group may name to address this crawler: the product token and the full UA product. */
const OWN_TOKENS = (token: string) => [token.toLowerCase(), `${token.toLowerCase()}-egress`];
const MAX_ROBOTS_BYTES = 500 * 1024;

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsPolicy {
  /** True when `pathAndQuery` (e.g. "/a/b?x=1") may be fetched by `ROBOTS_PRODUCT_TOKEN`. */
  isAllowed(pathAndQuery: string): boolean;
  /** How the policy was obtained, for the audit trail. */
  readonly basis: "parsed" | "no_file" | "unreachable";
}

/** Normalises percent-encoding so "/%7Ea" and "/~a" compare equal, keeping reserved escapes like %2F. */
function normalisePath(p: string): string {
  return p.replace(/%[0-9a-fA-F]{2}/g, (m) => {
    const c = String.fromCharCode(parseInt(m.slice(1), 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : m.toUpperCase();
  });
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (i === 0) {
      if (!path.startsWith(part)) return false;
      pos = part.length;
      continue;
    }
    const at = path.indexOf(part, pos);
    if (at < 0) return false;
    pos = at + part.length;
  }
  if (!anchored) return true;
  const last = parts[parts.length - 1] ?? "";
  return parts.length > 1 ? path.endsWith(last) : path === body;
}

/** Parses a robots.txt body into the rules that apply to `token`. */
export function parseRobots(text: string, token: string = ROBOTS_PRODUCT_TOKEN): RobotsPolicy {
  const tokens = OWN_TOKENS(token);
  const own: Rule[] = [];
  const star: Rule[] = [];
  // A group naming our token selects the own rules even when it has no rules (then everything is allowed).
  let ownMatched = false;
  let agents: string[] = [];
  // RFC 9309 2.2.1: the product token is matched case-insensitively (exactly, not as a substring).
  const isOwn = (a: string) => tokens.includes(a.replace(/\/.*$/, ""));
  let inRules = false;
  for (const raw of text.slice(0, MAX_ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      const agent = value.toLowerCase();
      agents.push(agent);
      if (isOwn(agent)) ownMatched = true;
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    inRules = true;
    if (value === "") continue; // an empty disallow (or allow) is no rule
    const rule: Rule = { allow: key === "allow", pattern: normalisePath(value) };
    if (agents.some(isOwn)) own.push(rule);
    if (agents.includes("*")) star.push(rule);
  }
  const rules = ownMatched ? own : star;
  return {
    basis: "parsed",
    isAllowed(pathAndQuery: string): boolean {
      const p = normalisePath(pathAndQuery === "" ? "/" : pathAndQuery);
      if (p === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const r of rules) {
        if (!matches(r.pattern, p)) continue;
        const len = r.pattern.length;
        if (best === null || len > best.pattern.length || (len === best.pattern.length && r.allow)) best = r;
      }
      return best === null || best.allow;
    },
  };
}

/** The policy when there is no file to parse, from the robots.txt fetch outcome (RFC 9309 section 2.3.1). */
export function robotsFromStatus(status: number | "unreachable"): RobotsPolicy {
  if (status !== "unreachable" && status >= 400 && status < 500) return { basis: "no_file", isAllowed: () => true };
  return { basis: "unreachable", isAllowed: (p) => normalisePath(p) === "/robots.txt" };
}
