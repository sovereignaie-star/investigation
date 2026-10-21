/**
 * P2-004 — cancellation propagation through the transform SDK.
 *
 * Proves the run's AbortSignal travels from `runTransform` through `ctx.http`
 * into the transport, and that a cancelled run never resolves to a success:
 * - cancel before the request → the transport is never called;
 * - cancel during an in-flight request (transport honours the signal) → the run
 *   fails with stage "cancel" and the failure is recorded as evidence;
 * - a transport that IGNORES the signal and resolves late → the response is
 *   refused (late-completion guard) and the run fails as cancelled;
 * - the exact signal object reaches the transport (propagation, not coincidence).
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
  admiralty: { reliability: "B", credibility: 3, rationale: "وسيط موثوق نسبياً — تثبيت اختبار" },
};

function okTransform() {
  return defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
    const res = await ctx.http.get(input.url);
    return {
      findings: [
        {
          predicate: "has_http_response",
          evidence: [res.requestId],
          objectType: "http_status",
          objectValue: String(res.status),
          confidence: 1,
          explanation: "t",
        },
      ],
    };
  });
}

describe("runTransform cancellation propagation", () => {
  it("a cancel before the request means the transport is never called", async () => {
    let calls = 0;
    const transport: HttpTransport = {
      async fetch() {
        calls++;
        return { status: 200, body: "" };
      },
    };
    const controller = new AbortController();
    controller.abort(new Error("user pressed stop"));
    await expect(
      runTransform(okTransform(), { transport, input: { url: "https://example.com/" }, signal: controller.signal }),
    ).rejects.toMatchObject({ stage: "cancel" });
    expect(calls).toBe(0);
  });

  it("the run signal propagates into the transport's signal (composite, not coincidence)", async () => {
    let seen: AbortSignal | undefined;
    const transport: HttpTransport = {
      async fetch(_req, signal) {
        seen = signal;
        return { status: 200, body: "" };
      },
    };
    const controller = new AbortController();
    await runTransform(okTransform(), { transport, input: { url: "https://example.com/" }, signal: controller.signal });
    expect(seen).toBeDefined();
    const transportSignal = seen as AbortSignal;
    expect(transportSignal.aborted).toBe(false);
    // Aborting the run signal aborts the signal the transport received.
    controller.abort(new Error("stop"));
    expect(transportSignal.aborted).toBe(true);
  });

  it("a cancel during an in-flight request (transport honours the signal) fails the run as cancelled with recorded evidence", async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    const transport: HttpTransport = {
      async fetch(_req, signal) {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true });
        });
        return { status: 200, body: "late" };
      },
    };
    const controller = new AbortController();
    const pending = runTransform(okTransform(), { transport, input: { url: "https://example.com/" }, signal: controller.signal });
    await startedP;
    controller.abort(new Error("user pressed stop mid-flight"));
    const err = await pending.catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("cancel");
    expect(err.evidence).toHaveLength(1);
    expect(err.evidence[0].error?.kind).toBe("cancel");
    expect(err.evidence[0].status).toBeUndefined();
  });

  it("a transport that IGNORES the signal and resolves late is refused (no late success)", async () => {
    const transport: HttpTransport = {
      async fetch(_req, _signal) {
        // Ignore the signal entirely; resolve with a success after the cancel.
        await new Promise((r) => setTimeout(r, 20));
        return { status: 200, body: "late success", headers: { server: "nginx" } };
      },
    };
    const controller = new AbortController();
    const pending = runTransform(okTransform(), { transport, input: { url: "https://example.com/" }, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 5);
    const err = await pending.catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("cancel");
    // The late response is recorded as a failure, never as a success.
    expect(err.evidence).toHaveLength(1);
    expect(err.evidence[0].error?.kind).toBe("cancel");
    expect(err.evidence[0].status).toBeUndefined();
  });

  it("a cancel while the transform is computing (no request) is not a success", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return { status: 200, body: "" };
      },
    };
    const controller = new AbortController();
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, _ctx) => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        findings: [{ predicate: "has_http_response", objectType: "http_status", objectValue: "200", confidence: 1, explanation: "t" }],
      };
    });
    const pending = runTransform(def, { transport, input: { url: "https://example.com/" }, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 5);
    const err = await pending.catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("cancel");
  });
});
