/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17): the GreyNoise provider registry entry (TR-045).
 * The key travels ONLY in the `key` header (verified 2026-10-17 from docs.greynoise.io). The
 * community endpoint carries the IPv4 subject in the PATH — a template row in the policy table;
 * this entry references it and declares NO literal requestPaths.
 */
import { greynoisePathPolicy } from "./post-policies.ts";
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const greynoise: ProviderRegistryEntry = {
  name: "greynoise",
  hosts: ["api.greynoise.io"],
  secretHeader: "key",
  manifestSecretNames: ["GREYNOISE_KEY"],
  vaultEntry: "greynoise",
  requestPaths: [],
  requestPathTemplates: greynoisePathPolicy.templates,
};
