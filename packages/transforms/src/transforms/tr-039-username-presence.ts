/**
 * P2-012 — TR-039: username presence across public profile pages (Sherlock-style).
 *
 * EXISTENCE ONLY: the transform checks whether a username resolves to a public
 * profile on a small curated list of sites and emits an account-existence finding
 * per hit — no profile content is extracted (ROADMAP: «وجود فقط»).
 *
 * Per-site semantics, MEASURED 2026-10-15 (see TL-tr039-username-sites.md):
 * - GitHub: profile page GET — 200 = exists, 404 = not (clean).
 * - GitLab: public API v4 users?username= — always 200; a non-empty JSON array
 *   = exists (the profile page itself 302-redirects and is unusable for this).
 * - Reddit: REMOVED — the profile page 301-redirects for both existing and
 *   missing users, and the JSON endpoint answers 403 (bot protection) — a
 *   reliable check requires OAuth credentials (declared limit, not in this batch).
 * A response the semantics above do not cover fails the run closed (a 403 from
 * bot protection must never be read as "no account").
 *
 * Sensitivity is `natural_person_gate` (E-02, per the ROADMAP): a username may
 * identify a person, so the engine requires a purpose confirmation before running.
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08).
 * Limits: rps 1, timeoutMs 15s, maxBytes 1MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";

/** Intersection of the three platforms' username rules (also satisfies each catalog pattern). */
const USERNAME = /^[a-zA-Z0-9_-]{3,20}$/;

interface Site {
  readonly name: string;
  /** Builds the check URL for the username (already encodeURIComponent-safe). */
  readonly url: (username: string) => string;
  /** Decides existence from the response; anything else fails closed. */
  readonly exists: (res: { status: number; body: string }) => boolean;
  /** Catalog type of the emitted object value (D-018: typed, pattern-checked). */
  readonly objectType: string;
}

const SITES: readonly Site[] = [
  {
    name: "GitHub",
    url: (u) => `https://github.com/${u}`,
    exists: (res) => {
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`TR-039: GitHub returned ${res.status} — existence undetermined`);
    },
    objectType: "github_username",
  },
  {
    name: "GitLab",
    url: (u) => `https://gitlab.com/api/v4/users?username=${u}`,
    exists: (res) => {
      if (res.status !== 200) throw new Error(`TR-039: GitLab returned ${res.status} — existence undetermined`);
      const parsed = JSON.parse(res.body) as unknown[];
      return Array.isArray(parsed) && parsed.length > 0;
    },
    objectType: "gitlab_username",
  },
];

export const usernamePresence = defineTransform<{ username: string }>(
  {
    id: "TR-039",
    version: "1.0.0",
    inputs: ["username"],
    outputs: ["github_username", "gitlab_username"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-B",
  },
  async (input, ctx) => {
    const username = input?.username?.trim() ?? "";
    if (username.length === 0) throw new Error("TR-039: a username is required");
    if (!USERNAME.test(username)) throw new Error(`TR-039: invalid username "${input?.username}"`);

    const findings: TransformFinding[] = [];
    for (const site of SITES) {
      const res = await ctx.http.get(site.url(encodeURIComponent(username)));
      if (site.exists(res)) {
        findings.push({
          predicate: "has_account",
          evidence: [res.requestId],
          objectType: site.objectType,
          objectValue: username,
          confidence: 0.9,
          explanation: `${site.name}: "${username}" has a public account (existence only — no content collected)`,
        });
      }
    }
    return { findings };
  },
);
