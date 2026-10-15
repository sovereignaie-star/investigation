/**
 * P2-012 — TR-039 contract test (T-RULE-06). Username presence (Sherlock-style):
 * EXISTENCE ONLY — no content is extracted. Per-site semantics MEASURED
 * 2026-10-15: GitHub profile page (200/404) and the public GitLab users API
 * (200 + non-empty array); Reddit is out (301-redirects / 403 bot-blocks —
 * requires OAuth; declared limit). The transform is gated on natural persons
 * (E-02): a run requires a purpose confirmation.
 *
 * Red first: this test was written before the transform existed and failed on
 * the missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { usernamePresence } from "./transforms/tr-039-username-presence.ts";
import { runTransform } from "./runner.ts";

const U = "someuser";

/** The exact GitHub profile URL the transform must build for the username this test uses. */
const GH_URL = `https://github.com/${U}`;
/** The exact GitLab users-API URL the transform must build for the username this test uses. */
const GL_URL = `https://gitlab.com/api/v4/users?username=${U}`;

describe("TR-039 username presence", () => {
  it("emits existence-only findings for the sites where the username exists", async () => {
    const sim = createSimServer([
      { match: GH_URL, response: { status: 200, body: "<html>profile</html>" } },
      { match: GL_URL, response: { status: 200, body: JSON.stringify([{ id: 1, username: U }]) } },
    ]);
    const result = await runTransform(usernamePresence, { transport: sim.transport, input: { username: U } });
    expect(result.requestCount).toBe(2);
    const findings = result.output.findings;
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_account", objectType: "github_username", objectValue: U, evidence: [0] }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_account", objectType: "gitlab_username", objectValue: U, evidence: [1] }),
    );
    // Existence only: no content-derived fields anywhere in the findings.
    for (const f of findings) expect(f.explanation).not.toContain("profile</html>");
  });

  it("a username absent everywhere is a legitimate empty result, not an error", async () => {
    const sim = createSimServer([
      { match: GH_URL, response: { status: 404, body: "" } },
      { match: GL_URL, response: { status: 200, body: "[]" } },
    ]);
    const result = await runTransform(usernamePresence, { transport: sim.transport, input: { username: U } });
    expect(result.requestCount).toBe(2);
    expect(result.output.findings).toHaveLength(0);
  });

  it("rejects an invalid username before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    for (const bad of ["ab", "has space", "ok_username#"]) {
      await expect(runTransform(usernamePresence, { transport: sim.transport, input: { username: bad } })).rejects.toThrow(
        /invalid username/,
      );
    }
    expect(sim.requestCount()).toBe(0);
  });

  it("an unexpected status (not 200/404) fails the run closed with the site and status", async () => {
    const sim = createSimServer([
      { match: GH_URL, response: { status: 200, body: "" } },
      { match: GL_URL, response: { status: 403, body: "" } },
    ]);
    await expect(runTransform(usernamePresence, { transport: sim.transport, input: { username: U } })).rejects.toThrow(
      /GitLab returned 403/,
    );
  });

  it("requires a username (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(usernamePresence, { transport: sim.transport, input: {} })).rejects.toThrow(/username is required/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a 200 whose body is outside the documented semantics (valid JSON, not an array) fails the run closed", async () => {
    const sim = createSimServer([
      { match: GH_URL, response: { status: 404, body: "" } },
      { match: GL_URL, response: { status: 200, body: JSON.stringify({ message: "403 Forbidden" }) } },
    ]);
    await expect(runTransform(usernamePresence, { transport: sim.transport, input: { username: U } })).rejects.toThrow(
      /GitLab returned 200 with a non-array body/,
    );
  });

  it("is gated on natural persons (E-02)", () => {
    expect(usernamePresence.manifest.sensitivity).toBe("natural_person_gate");
  });
});
