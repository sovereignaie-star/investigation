/**
 * P2-037 — shared RDAP helpers for TR-002 (domains) and TR-003 (IP networks, autonomous systems).
 *
 * IANA bootstrap files (RFC 9224) have the shape `{ services: [[keys[], urls[]], ...] }`: the second element is a
 * LIST of base URLs, not a string. The base URL chosen is the first `https://` one; an `http://` base is never used.
 * The bootstrap only says which server to ask — it never widens the operator's host list: a base whose host is not on
 * the explicit `--allow-host` list is refused by the egress gateway before any connection (ADR-08, audited as
 * `egress.request`/`denied`/`host_not_allowed`).
 *
 * Contact data: RDAP entities are jCard (RFC 7095). A registrant/owner is reported only when its jCard `kind` is
 * `org`; an `individual` or an owner without a declared kind is never turned into a finding, so no natural-person
 * contact data is collected from RDAP (data-protection policy). A registrar is an accredited organisation by role
 * (registries such as Verisign publish it without a `kind`), so for the `registrar` role an absent kind is accepted
 * and only an explicit `individual` is refused.
 */
import { parseJson } from "./util.ts";

export type BootstrapService = [string[], string[]];

/** Parses a bootstrap file and returns its services; malformed shapes fail the run. */
export function parseBootstrap(res: { status: number; body: string }, what: string): BootstrapService[] {
  if (res.status !== 200) throw new Error(`${what} answered HTTP ${res.status}`);
  const data = parseJson(res.body, what) as { services?: unknown };
  if (!data || !Array.isArray(data.services)) throw new Error(`${what}: no services list`);
  return data.services.filter(
    (s): s is BootstrapService =>
      Array.isArray(s) &&
      s.length >= 2 &&
      Array.isArray(s[0]) &&
      Array.isArray(s[1]) &&
      s[0].every((k: unknown) => typeof k === "string") &&
      s[1].every((u: unknown) => typeof u === "string"),
  );
}

/** The first https base URL of a service, with exactly one trailing slash; undefined when there is none. */
export function httpsBase(service: BootstrapService): string | undefined {
  const u = service[1].find((x) => /^https:\/\//i.test(x));
  return u ? u.replace(/\/+$/, "") + "/" : undefined;
}

type JCardProp = [string, Record<string, unknown>, string, ...unknown[]];

interface RdapEntity {
  roles?: unknown;
  vcardArray?: unknown;
  entities?: unknown;
}

function jcardProps(entity: RdapEntity): JCardProp[] {
  const v = entity.vcardArray;
  if (!Array.isArray(v) || v[0] !== "vcard" || !Array.isArray(v[1])) return [];
  return (v[1] as unknown[]).filter((p): p is JCardProp => Array.isArray(p) && typeof p[0] === "string");
}

/**
 * The `fn` of an organisation entity. `kindRequired` (owners): the jCard must declare `kind: org`. Otherwise
 * (registrars): an absent kind is accepted, an explicit non-org kind (`individual`, ...) is refused.
 */
export function orgName(entity: RdapEntity, kindRequired = true): string | undefined {
  const props = jcardProps(entity);
  const kind = props.find((p) => p[0] === "kind")?.[3];
  if (
    kindRequired ? typeof kind !== "string" || kind.toLowerCase() !== "org" : kind !== undefined && String(kind).toLowerCase() !== "org"
  ) {
    return undefined;
  }
  const fn = props.find((p) => p[0] === "fn")?.[3];
  return typeof fn === "string" && fn.trim().length > 0 ? fn.trim() : undefined;
}

/** Every entity (top level and nested) that holds `role`. */
export function entitiesWithRole(data: { entities?: unknown }, role: string): RdapEntity[] {
  const out: RdapEntity[] = [];
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 3) return;
    for (const e of list as RdapEntity[]) {
      if (!e || typeof e !== "object") continue;
      if (Array.isArray(e.roles) && e.roles.includes(role)) out.push(e);
      walk(e.entities, depth + 1);
    }
  };
  walk(data.entities, 0);
  return out;
}

/** RDAP answered "no such object" (404) — a genuine negative. Any other non-200 status fails the run. */
export function rdapNotFound(res: { status: number }, what: string): boolean {
  if (res.status === 404) return true;
  if (res.status !== 200) throw new Error(`${what} answered HTTP ${res.status}`);
  return false;
}
