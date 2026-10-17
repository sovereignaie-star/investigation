/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17): the VirusTotal provider registry entry (TR-043).
 * The key travels ONLY in the `x-apikey` header — the source's documented auth (verified
 * 2026-10-17 from docs.virustotal.com) — never the URL. The subject-carrying endpoints are PATH
 * templates declared in the policy table (post-policies.ts — the single source of truth); this
 * entry references them and declares NO literal requestPaths: the gateway validates every path
 * parameter centrally against its closed type (path-template.ts).
 */
import { virustotalPathPolicy } from "./post-policies.ts";
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const virustotal: ProviderRegistryEntry = {
  name: "virustotal",
  hosts: ["www.virustotal.com"],
  secretHeader: "x-apikey",
  manifestSecretNames: ["VIRUSTOTAL_KEY"],
  vaultEntry: "virustotal",
  requestPaths: [],
  requestPathTemplates: virustotalPathPolicy.templates,
};
