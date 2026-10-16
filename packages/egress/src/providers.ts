/**
 * ADR-08 §7 (P2-016): the provider registry — DATA, not gateway logic. Adding a provider means
 * adding a data file under `packages/egress/providers/` (and its tests), never touching the
 * general gateway code. Each entry states, explicitly:
 *
 * - `name`: the `secretProvider` key the gateway pins secret-bearing requests to;
 * - `hosts`: the exact hosts a secret of this provider may ever travel to (the gateway's
 *   `providerHosts` list — a secret request to any other host is refused before DNS);
 * - `secretHeader`: the ONE header the key travels in (lowercase). The key NEVER travels in the
 *   URL (D-031/P2-016); a provider whose API only accepts the key as a URL query has no entry
 *   here and its keyed network runs are refused with that documented reason;
 * - `manifestSecretNames`: the UPPER_SNAKE names a transform manifest may declare for this
 *   provider's key (e.g. `URLSCAN_KEY`) — the explicit binding from manifest to registry entry;
 * - `vaultEntry`: the vault entry name the key is read from (lowercase, per the vault's name
 *   rules). Declared explicitly — never inferred by stripping suffixes;
 * - `requestPaths`: the exact URL paths (no query, no fragment) a secret-bearing request of this
 *   provider may target — the gateway's `providerPaths` list (T-SEC-SSRF-042). These are the
 *   TRANSFORM's request paths, distinct from the server's fixed key-test path (P2-015 matrix);
 * - `queryAllowlist`: the CLOSED list of query parameters (name + value type + declared max
 *   length) a secret-bearing request of this provider may carry (P2-016 continuation, owner
 *   decision 2026-10-16). A parameter outside the list is refused fail-closed; a provider without
 *   an allowlist refuses every query (the unchanged default). Each parameter's source is
 *   documented in docs/security/KEY_TESTS.md (the provider matrix).
 */
import { urlscan } from "../providers/urlscan.ts";
import type { ProviderQueryAllow } from "./egress.ts";

export interface ProviderRegistryEntry {
  readonly name: string;
  readonly hosts: readonly string[];
  readonly secretHeader: string;
  readonly manifestSecretNames: readonly string[];
  readonly vaultEntry: string;
  readonly requestPaths: readonly string[];
  /** P2-016 continuation: the closed query-parameter allowlist (absent = every query refused). */
  readonly queryAllowlist?: readonly ProviderQueryAllow[];
}

/**
 * The registry itself — one data file per provider under `packages/egress/providers/`. urlscan is
 * the first (and currently only) header-compatible keyed provider whose transform (TR-009)
 * declares a vault secret. shodan (TR-008) and etherscan (TR-017) accept the key ONLY as a URL
 * query parameter — policy D-031/P2-016 forbids that, so they have no entry and their keyed
 * network runs are refused (see docs/security/KEY_TESTS.md for the full matrix).
 */
export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [urlscan];

/** The registry entry a manifest's declared secret name binds to, if any. */
export function registryEntryForSecret(secretName: string): ProviderRegistryEntry | undefined {
  return PROVIDER_REGISTRY.find((e) => e.manifestSecretNames.includes(secretName));
}
