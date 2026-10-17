/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17): the SecurityTrails provider registry entry
 * (TR-048). The key travels ONLY in the `apikey` header (verified 2026-10-17 from
 * docs.securitytrails.com). The DNS-history endpoint carries the hostname AND the record type in
 * the PATH — a template row in the policy table with a closed enum for the type; this entry
 * declares NO literal requestPaths.
 */
import { securitytrailsPathPolicy } from "./post-policies.ts";
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const securitytrails: ProviderRegistryEntry = {
  name: "securitytrails",
  hosts: ["api.securitytrails.com"],
  secretHeader: "apikey",
  manifestSecretNames: ["SECURITYTRAILS_KEY"],
  vaultEntry: "securitytrails",
  requestPaths: [],
  requestPathTemplates: securitytrailsPathPolicy.templates,
};
