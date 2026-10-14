/**
 * LIVE network acceptance test for `ir run --network` (P2-003). Skipped unless IR_LIVE_NETWORK_TESTS=1, so CI and
 * local runs stay deterministic; run it on purpose (workflow `live-network.yml`, manual dispatch) or locally:
 *
 *   IR_LIVE_NETWORK_TESTS=1 pnpm exec vitest run packages/cli/src/live-network.test.ts
 *
 * Nothing is injected: real DNS (`node:dns` lookup, every address classified), a pinned TLS connection verified
 * for the hostname (node-transport.ts), the transform in the real T-SBX sandbox, and a real case on disk. The
 * source is https://example.com/ (IANA-reserved for documentation, public, no personal data). The test asserts
 * the shape of the result, not its content, because a live page can change.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCase } from "@ir/store";
import { probeIsolation } from "@ir/transform-sandbox";
import { main } from "./ir.ts";

const LIVE = process.env["IR_LIVE_NETWORK_TESTS"] === "1";
const SOURCE = "https://example.com/";
const HOST = "example.com";
const full = LIVE ? (await probeIsolation()).full : false;

describe.skipIf(!LIVE)("LIVE: ir run --network against a public HTTPS source (P2-003)", () => {
  it.skipIf(!full)(
    "fetches example.com through @ir/egress with the transform isolated, and records evidence + findings + audit",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "ir-live-"));
      try {
        const out: string[] = [];
        const err: string[] = [];
        const code = await main(
          [
            "run",
            dir,
            "TR-010",
            "url",
            SOURCE,
            "--network",
            "--allow-host",
            HOST,
            "--purpose",
            "live acceptance test of the egress path against a public documentation host",
            "--legal-basis",
            "security_incident",
            "--json",
          ],
          (s) => out.push(s),
          (s) => err.push(s),
          { network: { env: { IR_ENABLE_NETWORK: "1" } } },
        );
        expect(err.join("\n")).toBe("");
        expect(code).toBe(0);
        const json = JSON.parse(out.join("\n")) as { network: unknown; requestCount: number; findings: Array<{ predicate: string }> };
        expect(json.network).toEqual({ mode: "real", allowedHosts: [HOST], isolated: true });
        expect(json.requestCount).toBeGreaterThanOrEqual(1);
        expect(json.findings.some((f) => f.predicate === "has_http_response")).toBe(true);

        const c = openCase(dir, { actor: "live-test" });
        try {
          const ev = c
            .entries()
            .filter((e) => e.kind === "evidence.stored")
            .map(
              (e) =>
                e.payload as { id: string; fetchedAt: string; size: number; sha256: string; request: { url: string; status?: number } },
            );
          expect(ev.length).toBeGreaterThanOrEqual(1);
          const first = ev[0];
          expect(first?.request.url).toBe(SOURCE);
          expect(first?.request.status).toBe(200);
          expect(first?.size).toBeGreaterThan(0);
          expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(Date.parse(first?.fetchedAt ?? "")).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
          const allowed = c.auditTrail().filter((a) => a.action === "egress.allowed");
          expect(allowed.map((a) => a.target)).toContain(HOST);
          console.log(
            `LIVE evidence: ${first?.request.url} status ${first?.request.status} size ${first?.size} sha256 ${first?.sha256} at ${first?.fetchedAt}`,
          );
        } finally {
          c.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("a live host that is not on --allow-host is refused before DNS (control)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ir-live-off-"));
    try {
      const err: string[] = [];
      const code = await main(
        [
          "run",
          dir,
          "TR-010",
          "url",
          "https://www.iana.org/",
          "--network",
          "--allow-host",
          HOST,
          "--purpose",
          "live control: off-list host is refused",
          "--legal-basis",
          "security_incident",
        ],
        () => {},
        (s) => err.push(s),
        { network: { env: { IR_ENABLE_NETWORK: "1" } } },
      );
      if (full) {
        expect(code).toBe(1);
        expect(err.join("\n")).toContain("host_not_allowed");
      } else {
        expect(code).not.toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
