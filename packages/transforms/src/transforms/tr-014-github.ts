/**
 * P2-010 — TR-014: GitHub (username/org/repo → public profile, repos).
 *
 * Source: GitHub REST API (`api.github.com`), public, no key (LC-C). The
 * transform queries the user/org endpoint and the repos endpoint and emits
 * findings for the public profile (name, bio, location) and public
 * repositories. Sensitivity is `natural_person_gate` (E-02): the engine
 * requires purpose confirmation before running this transform on a person.
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import { isGithubUsername, parseJson } from "./util.ts";

const API = "https://api.github.com";

export const githubProfile = defineTransform<{ username: string }>(
  {
    id: "TR-014",
    version: "1.0.0",
    inputs: ["username"],
    outputs: ["github_username", "git_repo", "email"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-C",
  },
  async (input, ctx) => {
    const username = input.username.trim();
    if (!isGithubUsername(username)) throw new Error(`TR-014: invalid GitHub username "${input.username}"`);
    const userRes = await ctx.http.get(`${API}/users/${encodeURIComponent(username)}`);
    const user = parseJson(userRes.body, "GitHub") as {
      login?: string;
      name?: string;
      bio?: string;
      location?: string;
      email?: string;
      public_repos?: number;
    };

    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    if (user.name) {
      findings.push({
        predicate: "has_display_name",
        objectType: "github_username",
        objectValue: user.name,
        confidence: 0.9,
        explanation: `GitHub: ${username} displays name "${user.name}"`,
      });
    }
    if (user.email) {
      findings.push({
        predicate: "has_public_email",
        objectType: "email",
        objectValue: user.email,
        confidence: 0.9,
        explanation: `GitHub: ${username} has public email ${user.email}`,
      });
    }
    if (user.location) {
      findings.push({
        predicate: "has_location",
        objectType: "github_username",
        objectValue: user.location,
        confidence: 0.8,
        explanation: `GitHub: ${username} lists location "${user.location}"`,
      });
    }

    // Fetch public repos (first page).
    const reposRes = await ctx.http.get(`${API}/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`);
    const repos = parseJson(reposRes.body, "GitHub") as Array<{ full_name?: string; html_url?: string }>;
    for (const repo of repos) {
      if (repo.html_url) {
        findings.push({
          predicate: "owns_repository",
          objectType: "git_repo",
          objectValue: repo.html_url,
          confidence: 0.9,
          explanation: `GitHub: ${username} owns ${repo.full_name ?? repo.html_url}`,
        });
      }
    }
    return { findings };
  },
);
