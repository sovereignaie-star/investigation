/**
 * Real DNS resolver for the egress gateway (P2-003 / ADR-08). It returns EVERY address the system resolver gives
 * for a host (A and AAAA, `all: true`, resolver order kept), so the gateway can classify all of them and refuse the
 * whole request when any one is not public (a split answer such as [public, 10.0.0.1] is a rebinding attempt). The
 * gateway then pins one classified address and the transport connects to that address only (node-transport.ts),
 * so a second lookup at connect time cannot change the destination.
 *
 * This module is the only place outside the transport that touches `node:dns`. It never returns hostnames, never
 * caches (a cached answer would outlive its TTL), and never falls back to anything on failure: a lookup error, an
 * empty answer or a non-IP value all reject, and the gateway maps that to `address_class` before any connection.
 * Timeouts and cancellation are enforced by the gateway (`resolveBounded`), not here.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DnsResolver } from "./egress.ts";

/** The subset of `dns.promises.lookup` this resolver uses; injectable for deterministic tests. */
export type LookupAll = (host: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

export interface SystemResolverOptions {
  /** Injected lookup (tests). Default: `node:dns/promises` `lookup` with `all: true`. */
  readonly lookup?: LookupAll;
  /** Upper bound on the number of addresses returned to the gateway (all are classified). Default 64. */
  readonly maxAddresses?: number;
}

export class DnsResolutionError extends Error {}

export function createSystemResolver(opts: SystemResolverOptions = {}): DnsResolver {
  const lookup: LookupAll = opts.lookup ?? ((host, o) => dnsLookup(host, o));
  const maxAddresses = opts.maxAddresses ?? 64;
  return {
    async resolve(host: string): Promise<string[]> {
      if (host === "" || host.length > 253 || isIP(host) !== 0) {
        // Literal addresses are classified by the gateway without DNS; a resolver call for one is a caller bug.
        throw new DnsResolutionError("not a hostname");
      }
      const answers = await lookup(host, { all: true, verbatim: true });
      if (!Array.isArray(answers) || answers.length === 0) throw new DnsResolutionError("no addresses");
      if (answers.length > maxAddresses) throw new DnsResolutionError(`more than ${maxAddresses} addresses`);
      const out: string[] = [];
      for (const a of answers) {
        if (typeof a?.address !== "string" || isIP(a.address) === 0) throw new DnsResolutionError("non-IP answer");
        if (!out.includes(a.address)) out.push(a.address);
      }
      return out;
    },
  };
}
