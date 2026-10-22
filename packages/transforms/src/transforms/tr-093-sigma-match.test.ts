import { describe, expect, it } from "vitest";
import { sigmaMatch } from "./tr-093-sigma-match.ts";

/**
 * P4-021 — TR-093: Sigma rule matching over imported structured log events
 * (local LC-A; pure evaluation, nothing fetched or executed; the frozen
 * official SigmaHQ rules are bundled, normalized). Every match is a finding
 * whose evidence is the INPUT EVENTS (derivedFrom "input").
 */

const events7z = [
  {
    Description: "7-Zip archiver",
    Image: "C:\\Program Files\\7z.exe",
    CommandLine: "7z.exe a -psecret archive.zip C:\\data",
    _time: "2026-10-22T12:00:00Z",
  },
  { Image: "C:\\windows\\system32\\cmd.exe", CommandLine: "dir", _time: "2026-10-22T12:01:00Z" },
];

describe("TR-093 — Sigma matching (مطابقة قواعد Sigma على السجلات)", () => {
  it("matches the frozen rules against crafted events and emits findings bound to the input", async () => {
    const out = await sigmaMatch.run({ events: events7z }, ctxOf());
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f).toMatchObject({ predicate: "sigma_match", objectType: "sigma_rule" });
    expect(f.objectValue).toContain("7-ZIP");
    expect(f.derivedFrom).toBe("input");
    expect(f.explanation).toContain("Description=7-Zip archiver");
  });

  it("no match on unrelated events — no invented findings", async () => {
    const out = await sigmaMatch.run({ events: [{ Image: "C:\\windows\\system32\\cmd.exe", CommandLine: "dir" }] }, ctxOf());
    expect(out.findings).toEqual([]);
  });

  it("refuses empty or non-object input — fail-closed", async () => {
    await expect(sigmaMatch.run({ events: [] }, ctxOf())).rejects.toThrow();
    await expect(sigmaMatch.run({ events: "nope" } as unknown as { events: unknown[] }, ctxOf())).rejects.toThrow();
    await expect(sigmaMatch.run({} as { events: unknown[] }, ctxOf())).rejects.toThrow();
  });

  it("the manifest is local (public, empty allow list) and LC-A", () => {
    expect(sigmaMatch.manifest.license).toBe("LC-A");
    expect(sigmaMatch.manifest.network).toMatchObject({ mode: "public", allow: [] });
    expect(sigmaMatch.manifest.inputs).toContain("log_events");
  });
});

function ctxOf(): never {
  return { manifest: sigmaMatch.manifest } as never;
}
