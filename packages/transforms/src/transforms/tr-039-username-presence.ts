/**
 * P2-012 — TR-039: username presence across public profile pages (Sherlock-style).
 *
 * EXISTENCE ONLY: the transform checks whether a username resolves to a public
 * profile on a small curated list of sites and emits an account-existence finding
 * per hit — no profile content is extracted (ROADMAP: «وجود فقط»). Sites are
 * public pages with stable URL patterns and documented 200/404 semantics; a
 * response that is neither 200 nor 404 fails the run closed (a 403 from bot
 * protection must never be read as "no account").
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
  readonly host: string;
  readonly prefix: string;
  /** Catalog type of the emitted object value (D-018: typed, pattern-checked). */
  readonly objectType: string;
}

const SITES: readonly Site[] = [
  { name: "GitHub", host: "github.com", prefix: "", objectType: "github_username" },
  { name: "Reddit", host: "www.reddit.com", prefix: "user/", objectType: "reddit_username" },
  { name: "GitLab", host: "gitlab.com", prefix: "", objectType: "gitlab_username" },
];

export const usernamePresence = defineTransform<{ username: string }>(
  {
    id: "TR-039",
    version: "1.0.0",
    inputs: ["username"],
    outputs: ["github_username", "reddit_username", "gitlab_username"],
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
      const res = await ctx.http.get(`https://${site.host}/${site.prefix}${encodeURIComponent(username)}`);
      if (res.status === 200) {
        findings.push({
          predicate: "has_account",
          evidence: [res.requestId],
          objectType: site.objectType,
          objectValue: username,
          confidence: 0.9,
          explanation: `${site.name}: "${username}" has a public profile at https://${site.host}/${site.prefix}${username} (existence only — no content collected)`,
        });
      } else if (res.status !== 404) {
        // Fail closed: bot-protection (403), rate limiting (429) or an outage (5xx)
        // must never be read as "no account".
        throw new Error(`TR-039: ${site.name} returned ${res.status} for "${username}" — existence undetermined`);
      }
    }
    return { findings };
  },
);
