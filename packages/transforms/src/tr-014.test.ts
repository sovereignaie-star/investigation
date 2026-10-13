/**
 * P2-010 — TR-014 contract test (T-RULE-06). Runs the GitHub transform against
 * a deterministic sim and asserts profile + repo findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { githubProfile } from "./transforms/tr-014-github.ts";
import { runTransform } from "./runner.ts";

describe("TR-014 github", () => {
  it("emits profile and repository findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.github\.com\/users\/octocat$/,
        response: {
          status: 200,
          body: JSON.stringify({ login: "octocat", name: "The Octocat", email: "octocat@example.com", location: "San Francisco" }),
        },
      },
      {
        match: /^https:\/\/api\.github\.com\/users\/octocat\/repos/,
        response: {
          status: 200,
          body: JSON.stringify([{ full_name: "octocat/Hello-World", html_url: "https://github.com/octocat/Hello-World" }]),
        },
      },
    ]);
    const result = await runTransform(githubProfile, { transport: sim.transport, input: { username: "octocat" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_display_name", objectType: "github_username", objectValue: "The Octocat" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_public_email", objectType: "email", objectValue: "octocat@example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "owns_repository",
        objectType: "git_repo",
        objectValue: "https://github.com/octocat/Hello-World",
      }),
    );
  });

  it("rejects an invalid username before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(githubProfile, { transport: sim.transport, input: { username: "not valid!" } })).rejects.toThrow(
      /invalid GitHub username/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
