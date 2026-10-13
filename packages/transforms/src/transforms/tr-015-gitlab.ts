/**
 * P2-010 — TR-015: GitLab (username/group → public profile, projects).
 *
 * Source: GitLab API (`gitlab.com`), public, no key (LC-C). The transform
 * queries the user endpoint and the projects endpoint and emits findings for
 * the public profile (name, bio, location) and public projects. Sensitivity is
 * `natural_person_gate` (E-02).
 *
 * All network I/O goes through `ctx.http` (egress gateway in production).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import { isGitlabUsername, parseJson } from "./util.ts";

const API = "https://gitlab.com/api/v4";

export const gitlabProfile = defineTransform<{ username: string }>(
  {
    id: "TR-015",
    version: "1.0.0",
    inputs: ["username"],
    outputs: ["gitlab_username", "git_repo", "email"],
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-C",
  },
  async (input, ctx) => {
    const username = input.username.trim();
    if (!isGitlabUsername(username)) throw new Error(`TR-015: invalid GitLab username "${input.username}"`);
    const userRes = await ctx.http.get(`${API}/users?username=${encodeURIComponent(username)}`);
    const users = parseJson(userRes.body, "GitLab") as Array<{
      id?: number;
      name?: string;
      username?: string;
      bio?: string;
      location?: string;
      public_email?: string;
    }>;
    const user = users[0];

    const findings: Array<{ predicate: string; objectType: string; objectValue: string; confidence: number; explanation: string }> = [];
    if (!user) return { findings };
    if (user.name) {
      findings.push({
        predicate: "has_display_name",
        objectType: "gitlab_username",
        objectValue: user.name,
        confidence: 0.9,
        explanation: `GitLab: ${username} displays name "${user.name}"`,
      });
    }
    if (user.public_email) {
      findings.push({
        predicate: "has_public_email",
        objectType: "email",
        objectValue: user.public_email,
        confidence: 0.9,
        explanation: `GitLab: ${username} has public email ${user.public_email}`,
      });
    }
    if (user.location) {
      findings.push({
        predicate: "has_location",
        objectType: "gitlab_username",
        objectValue: user.location,
        confidence: 0.8,
        explanation: `GitLab: ${username} lists location "${user.location}"`,
      });
    }

    const projectsRes = await ctx.http.get(`${API}/users/${user.id}/projects?per_page=100&simple=true`);
    const projects = parseJson(projectsRes.body, "GitLab") as Array<{ web_url?: string; path_with_namespace?: string }>;
    for (const project of projects) {
      if (project.web_url) {
        findings.push({
          predicate: "owns_repository",
          objectType: "git_repo",
          objectValue: project.web_url,
          confidence: 0.9,
          explanation: `GitLab: ${username} owns ${project.path_with_namespace ?? project.web_url}`,
        });
      }
    }
    return { findings };
  },
);
