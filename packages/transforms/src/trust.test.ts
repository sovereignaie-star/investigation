/**
 * P2-004 — trust boundary of the in-process runner.
 *
 * Documents and enforces the boundary honestly: `runTransform` executes the
 * transform IN-PROCESS, which provides NO runtime isolation. The static
 * `no-direct-network` guard is not a substitute. These tests prove:
 * - in-process execution gives the transform access to host capabilities
 *   (process.env), which is exactly why untrusted transforms must not run here;
 * - `requireIsolation: true` refuses to run (fail-closed), so production wiring
 *   cannot accidentally execute untrusted transforms in-process;
 * - the sandbox (`@ir/sandbox`, P2-005) is the layer responsible for runtime
 *   isolation; this runner is the in-process contract path (tests, @ir/sim).
 */
import { describe, expect, it } from "vitest";
import { defineTransform } from "./manifest.ts";
import { runTransform, TransformRunError } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const MANIFEST = {
  id: "TR-010",
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["http_response"],
  network: { mode: "public", allow: [] },
  secrets: [],
  limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
  sensitivity: "normal",
  license: "LC-B",
};

const transport: HttpTransport = {
  async fetch() {
    return { status: 200, body: "" };
  },
};

describe("trust boundary", () => {
  it("in-process execution exposes host capabilities to the transform (why the sandbox is required)", async () => {
    const def = defineTransform(MANIFEST, async () => {
      // In-process, the transform can read the host environment. This is the
      // documented boundary: the runner is NOT an isolation boundary.
      return {
        findings: [
          {
            predicate: "has_env",
            objectType: "text",
            objectValue: String(typeof process.env.PATH),
            confidence: 1,
            explanation: "in-process",
          },
        ],
      };
    });
    const result = await runTransform(def, { transport, input: {} });
    expect(result.output.findings[0].objectValue).toBe("string");
  });

  it("requireIsolation: true refuses to run in-process (fail-closed)", async () => {
    const def = defineTransform(MANIFEST, async () => ({ findings: [] }));
    const err = await runTransform(def, { transport, input: {}, requireIsolation: true }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("refused");
    expect(err.message).toContain("isolation");
  });
});
