/**
 * P2-010 — TR-015 contract test (T-RULE-06). Runs the GitLab transform against
 * a deterministic sim and asserts profile + project findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { gitlabProfile } from "./transforms/tr-015-gitlab.ts";
import { runTransform } from "./runner.ts";

describe("TR-015 gitlab", () => {
  it("emits profile and project findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/gitlab\.com\/api\/v4\/users\?username=/,
        response: {
          status: 200,
          body: JSON.stringify([
            { id: 1, name: "GitLab User", username: "gitlabuser", public_email: "user@example.com", location: "Berlin" },
          ]),
        },
      },
      {
        match: /^https:\/\/gitlab\.com\/api\/v4\/users\/1\/projects/,
        response: {
          status: 200,
          body: JSON.stringify([{ path_with_namespace: "gitlabuser/project", web_url: "https://gitlab.com/gitlabuser/project" }]),
        },
      },
    ]);
    const result = await runTransform(gitlabProfile, { transport: sim.transport, input: { username: "gitlabuser" } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_display_name", objectType: "gitlab_username", objectValue: "GitLab User" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_public_email", objectType: "email", objectValue: "user@example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "owns_repository",
        objectType: "git_repo",
        objectValue: "https://gitlab.com/gitlabuser/project",
      }),
    );
  });

  it("rejects an invalid username before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(gitlabProfile, { transport: sim.transport, input: { username: "not valid!" } })).rejects.toThrow(
      /invalid GitLab username/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
