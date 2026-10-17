/**
 * ADR-08 §7 (P2-026, owner decision 2026-10-17): the AlienVault OTX provider registry entry
 * (TR-046). The key travels ONLY in the `X-OTX-API-KEY` header (verified 2026-10-17 from the
 * official external API docs). The indicator-carrying endpoints are PATH templates in the policy
 * table (ip/domain/hostname/file — the `url` indicator type is deliberately excluded: its
 * segment is a percent-encoded full URL which no closed type accepts; documented for the owner);
 * this entry declares NO literal requestPaths.
 */
import { otxPathPolicy } from "./post-policies.ts";
import type { ProviderRegistryEntry } from "../src/providers.ts";

export const otx: ProviderRegistryEntry = {
  name: "otx",
  hosts: ["otx.alienvault.com"],
  secretHeader: "x-otx-api-key",
  manifestSecretNames: ["OTX_KEY"],
  vaultEntry: "otx",
  requestPaths: [],
  requestPathTemplates: otxPathPolicy.templates,
};
