/**
 * P2-010 — TR-019: PGP keys (email/fingerprint → public key).
 *
 * Source: keys.openpgp.org (`keys.openpgp.org`), public, no key (LC-B). The
 * transform queries the key lookup endpoint and emits findings for the public
 * key fingerprint. Sensitivity is `natural_person_gate` (E-02) because a key
 * lookup by email can identify a person.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isEmail, isPgpFingerprint } from "./util.ts";

const API = "https://keys.openpgp.org/vks/v1";

export const pgpKeys = defineTransform<{ email?: string; fingerprint?: string }>(
  {
    id: "TR-019",
    version: "1.0.0",
    inputs: ["email", "fingerprint"],
    outputs: ["pgp_fingerprint", "email"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "خادم مفاتيح openpgp العام — المفاتيح منشورة من أصحابها لكن النشر مفتوح وغير مُدقق",
    },
  },
  async (input, ctx) => {
    const findings: TransformFinding[] = [];
    if (input.email !== undefined) {
      const email = input.email.trim();
      if (!isEmail(email)) throw new Error(`TR-019: invalid email "${input.email}"`);
      const res = await ctx.http.get(`${API}/by-email/${encodeURIComponent(email)}`);
      if (res.status === 200 && res.body.trim()) {
        findings.push({
          predicate: "has_pgp_key",
          evidence: [res.requestId],
          objectType: "email",
          objectValue: email,
          confidence: 0.9,
          explanation: `keys.openpgp.org: public key found for ${email}`,
        });
      }
    }
    if (input.fingerprint !== undefined) {
      const fingerprint = input.fingerprint.trim();
      if (!isPgpFingerprint(fingerprint)) throw new Error(`TR-019: invalid PGP fingerprint "${input.fingerprint}"`);
      const res = await ctx.http.get(`${API}/by-fingerprint/${encodeURIComponent(fingerprint.replace(/\s/g, ""))}`);
      if (res.status === 200 && res.body.trim()) {
        findings.push({
          predicate: "has_pgp_key",
          evidence: [res.requestId],
          objectType: "pgp_fingerprint",
          objectValue: fingerprint,
          confidence: 0.9,
          explanation: `keys.openpgp.org: public key found for fingerprint ${fingerprint}`,
        });
      }
    }
    return { findings };
  },
);
