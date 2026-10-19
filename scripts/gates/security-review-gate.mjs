#!/usr/bin/env node
// P6-018 (owner decision 2026-10-19): the D-8 mandatory human review is ABOLISHED. The automated checks
// (CI, CodeQL, gitleaks, governance, build, test) are the only merge gate; no human review is required.
// This gate keeps exactly one human brake: an explicit HOLD comment by the designated reviewer stops the
// merge ("أبقِ آلية HOLD فقط"). D-8 paths are still detected and reported, as an advisory only.
//
// The decision is a pure function (`decide`) over data read from the GitHub API, so it is unit-tested without a
// network (security-review-gate.test.mjs). `main` reads the pull request, every page of its files and reviews, and
// fails closed: any API error, an incomplete file list or a head that moved during the check is a failure.
//
// Used by .github/workflows/security-review.yml. It never checks out or runs code from the pull request.

/** The designated reviewer. The numeric id is checked, not only the login, because logins can be renamed. */
export const REVIEWER = Object.freeze({ login: "xuuux-voox", id: 334893315 });

/** D-8 paths. Directories end with "/"; anything else is an exact file. Mirrored in .github/CODEOWNERS (tested). */
export const D8_PATHS = Object.freeze([
  "packages/egress/",
  "packages/transforms/",
  "packages/sandbox/",
  "packages/engine/",
  "packages/store/",
  "apps/server/",
  "lib/api-client-react/src/custom-fetch.ts",
  "scripts/gates/",
  "scripts/checks/",
  ".github/workflows/",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  "docs/adr/ADR-08-egress-gateway.md",
]);

/** A review from someone without repository access does not count, even from the right account. */
const TRUSTED_ASSOCIATION = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);

export function isD8Path(file) {
  return D8_PATHS.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
}

/**
 * @param {{ headSha: string, changedFiles: number,
 *           files: { filename: string, previous_filename?: string }[],
 *           reviews: { id: number, user: { login: string, id: number } | null, state: string,
 *                      commit_id: string | null, author_association: string, submitted_at?: string | null }[] }} pr
 * @returns {{ pass: boolean, reason: string, touched: string[] }}
 */
/**
 * @param {{ headSha: string, changedFiles: number,
 *           files: { filename: string, previous_filename?: string }[],
 *           reviews: { id: number, user: { login: string, id: number } | null, state: string,
 *                      commit_id: string | null, author_association: string, body?: string | null,
 *                      submitted_at?: string | null }[] }} pr
 * @returns {{ pass: boolean, reason: string, touched: string[] }}
 */
export function decide({ headSha, changedFiles, files, reviews }) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) return { pass: false, reason: "head commit unknown", touched: [] };
  if (!Number.isInteger(changedFiles) || files.length !== changedFiles)
    return {
      pass: false,
      reason: `file list incomplete: ${files.length} listed of ${changedFiles} changed`,
      touched: [],
    };
  // a rename out of a D-8 path touches it as much as an edit inside it (advisory report)
  const touched = [...new Set(files.flatMap((f) => [f.filename, f.previous_filename]).filter((f) => f && isD8Path(f)))].sort();
  const who = `@${REVIEWER.login}`;
  // HOLD (P6-018): the designated reviewer's LATEST review decides. An explicit HOLD token in its body stops
  // the merge; a later review without one clears it. No waiting period, no other human gate.
  const byReviewer = reviews
    .filter((r) => r.user?.id === REVIEWER.id && TRUSTED_ASSOCIATION.has(r.author_association))
    .sort((a, b) => a.id - b.id);
  const last = byReviewer.at(-1);
  if (last && /\bHOLD\b/i.test(last.body ?? ""))
    return { pass: false, reason: `HOLD by ${who}: merging stops until the reviewer lifts it`, touched };
  return {
    pass: true,
    reason:
      touched.length > 0
        ? `D-8 paths touched (advisory only — mandatory D-8 review abolished by owner decision 2026-10-19); no HOLD by ${who}`
        : `no D-8 path touched; no HOLD by ${who}`,
    touched,
  };
}

// ---------------------------------------------------------------------------------------------------------------
async function api(path, token) {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "investigation-security-review-gate",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.replace(/\?.*$/, "")}`);
  return res.json();
}

async function allPages(path, token, max = 30) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const batch = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error(`unexpected response for ${path}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  throw new Error(`more than ${max * 100} items at ${path}`);
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: number, EVENT_HEAD_SHA: eventHead } = process.env;
  if (!token || !repo || !/^\d+$/.test(number ?? "")) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER required");
  const base = `/repos/${repo}/pulls/${number}`;
  const pr = await api(base, token);
  const headSha = pr.head?.sha;
  const [files, reviews] = await Promise.all([allPages(`${base}/files`, token), allPages(`${base}/reviews`, token)]);
  // the head must not move while the data was read, and must be the commit this run reports on
  const again = await api(base, token);
  if (again.head?.sha !== headSha) throw new Error("head commit moved during the check; a new run follows");
  if (eventHead && eventHead !== headSha)
    throw new Error(`this run is for ${eventHead.slice(0, 7)} but the head is ${String(headSha).slice(0, 7)}`);

  const result = decide({ headSha, changedFiles: pr.changed_files, files, reviews });
  console.log(`security-review-gate: PR #${number} head ${headSha.slice(0, 7)}: ${result.pass ? "PASS" : "FAIL"}`);
  console.log(`  ${result.reason}`);
  for (const f of result.touched) console.log(`  D-8 path: ${f}`);
  process.exit(result.pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((x) => {
    // fail closed: an error is never a pass
    console.error(`security-review-gate: FAIL (${x instanceof Error ? x.message : String(x)})`);
    process.exit(1);
  });
}
