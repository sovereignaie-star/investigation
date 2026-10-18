/**
 * T-ISO (P2-005) — the isolated runner wired to the REAL sandbox.
 *
 * These tests prove the P2-005 wiring end to end: `runTransform` with
 * `requireIsolation: true` + `isolatedModule` executes the transform in the
 * sandbox (seccomp + bubblewrap namespaces), its network goes through the
 * injected transport (here `@ir/sim`) via IPC, the manifest's limits are
 * enforced, and failures are typed by stage exactly like the in-process runner.
 *
 * The suite is skipped on hosts where the sandbox cannot provide "full"
 * isolation (no Linux, no C compiler, no unprivileged user namespaces) — the
 * T-SBX suite documents those hosts. On this host the full level is live-probed
 * and exercised.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim";
import { runTransform, TransformRunError } from "./runner.ts";

import { probeIsolation } from "@ir/transform-sandbox";
// The module-load probe doubles as the warmup: it pays the launcher build + probe cost here,
// OUTSIDE any test's 5s timeout (the first sandboxed test would otherwise pay it and time out).
// P2-028 (owner decision): no skipIf — the tests RUN wherever this file loads; without full
// isolation they fail honestly (the CI gates job now installs bubblewrap too).
await probeIsolation();

const MODULE = fileURLToPath(new URL("./transforms/tr-iso-test-transforms.spec.ts", import.meta.url));
const TR010 = fileURLToPath(new URL("./transforms/tr-010-http-scan.ts", import.meta.url));
const TR089 = fileURLToPath(new URL("./transforms/tr-089-eml-msg.ts", import.meta.url));

const sim = createSimServer([
  { match: "https://example.com/", response: { status: 200, body: "<html></html>", headers: { server: "nginx" } } },
  { match: "https://slow.example/", response: { status: 200, body: "slow", delayMs: 5_000 } },
  { match: "https://big.example/", response: { status: 200, body: "x".repeat(2_000_000) } },
  { match: "https://unmatched.example/", response: { status: 200, body: "ok" } },
  { match: "https://a.example/", response: { status: 200, body: "A", delayMs: 60 } },
  { match: "https://b.example/", response: { status: 200, body: "B", delayMs: 30 } },
  { match: "https://c.example/", response: { status: 200, body: "C" } },
]);

describe("T-ISO: isolated runner against the real sandbox", () => {
  it("T-ISO-001: a transform runs successfully in the sandbox, network via the injected transport", async () => {
    sim.reset();
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://example.com/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-101",
    });
    expect(result.requestCount).toBe(1);
    expect(result.evidence[0].url).toBe("https://example.com/");
    expect(result.evidence[0].status).toBe(200);
    expect(result.output.findings[0]).toMatchObject({ predicate: "has_http_response", objectValue: "200" });
    // The request went through the injected transport (the sim), not a direct socket.
    expect(sim.requestCount()).toBe(1);
    expect(sim.requests[0].url).toBe("https://example.com/");
  });

  it("T-ISO-002: requireIsolation without a module refuses (fail-closed, no silent in-process fallback)", async () => {
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://example.com/" },
      requireIsolation: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("refused");
    expect(err.message).toContain("isolation");
  });

  it("T-ISO-003: a transform that opens a direct TCP socket is blocked by the sandbox", async () => {
    sim.reset();
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "12345" }, // the port the hostile transform tries to connect to
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-102",
    });
    // The direct connect is refused by seccomp: the transform sees an error, never a connection.
    expect(result.output.findings[0].objectValue).toMatch(/^error:/);
    expect(result.output.findings[0].objectValue).not.toBe("connected");
    // No request reached the injected transport — the network path is the gateway only.
    expect(sim.requestCount()).toBe(0);
  });

  it("T-ISO-004: a transform that reads the host filesystem is blocked at full isolation", async () => {
    sim.reset();
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: {},
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-103",
    });
    // At "full" the file is not visible: the transform reports "blocked".
    expect(result.output.findings[0].objectValue).toBe("blocked");
  });

  it("T-ISO-005: requests go through the enforced gateway (the injected transport), never direct", async () => {
    sim.reset();
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://example.com/" },
      requireIsolation: true,
      isolatedModule: TR010,
      transformId: "TR-010",
    });
    expect(result.requestCount).toBe(1);
    expect(sim.requestCount()).toBe(1);
    expect(result.output.findings[0]).toMatchObject({ predicate: "has_http_response", objectValue: "200" });
    expect(result.output.findings).toContainEqual(expect.objectContaining({ predicate: "has_technology", objectValue: "server: nginx" }));
  });

  it("T-ISO-006: cancellation kills the sandboxed process tree and fails with stage cancel", async () => {
    sim.reset();
    const controller = new AbortController();
    const run = runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://slow.example/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-101",
      signal: controller.signal,
      sandboxTimeoutMs: 20_000,
    });
    setTimeout(() => controller.abort(new Error("test cancel")), 300);
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("cancel");
  });

  it("T-ISO-007: a request exceeding the manifest timeoutMs fails with stage request, kind timeout", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://slow.example/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-109", // timeoutMs: 1_000 < the sim's 5s delay
      sandboxTimeoutMs: 20_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("timeout");
  });

  it("T-ISO-008: a response larger than maxBytes fails with stage request, kind size_limit", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://big.example/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-101",
      sandboxTimeoutMs: 20_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error?.kind).toBe("size_limit");
  });

  it("T-ISO-009: invalid output fails validation with stage validation", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: {},
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-104",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("validation");
  });

  it("T-ISO-010: a transform that throws fails with stage transform", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: {},
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-105",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("transform");
    expect(err.message).toContain("iso-transform exploded");
  });

  it("T-ISO-011: a hanging transform is killed by the sandbox timeout (no orphan process)", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: {},
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-106",
      sandboxTimeoutMs: 2_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("transform");
    expect(err.message).toContain("timed out");
  });

  it("T-ISO-012: rps is enforced on the isolated path (requests spaced by the manifest's rate)", async () => {
    sim.reset();
    const start = Date.now();
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://example.com/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-107",
      sandboxTimeoutMs: 20_000,
    });
    const elapsed = Date.now() - start;
    expect(result.requestCount).toBe(3);
    // rps: 1 → 3 requests need at least ~2s of spacing.
    expect(elapsed).toBeGreaterThanOrEqual(1_800);
  });

  it("T-ISO-013: a transform's secret never appears in the recorded evidence", async () => {
    sim.reset();
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: {},
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-108",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    // The parent's evidence is clean: no request was made, so nothing sensitive is recorded.
    expect(err.evidence).toHaveLength(0);
    // The error message is the transform's own (bounded, no log injection): the parent
    // relays it exactly as the in-process runner does, but never records it as evidence.
    expect(err.message).toContain("SUPER_SECRET_TOKEN_XYZ");
  });

  it("T-ISO-0089 (P2-034): a hostile MSG fails closed inside the sandbox; a valid one parses there", async () => {
    const { buildMsg } = await import("./transforms/ole2-builder.test-helper.ts");
    const good = buildMsg({
      subject: "s",
      senderEmail: "a@example.org",
      displayTo: "b@example.org",
      transportHeaders: "",
      body: "hello https://example.org/x",
      attachmentFilename: "a.bin",
      attachmentData: Buffer.from("payload"),
    });
    const ok = await runTransform(undefined, {
      transport: sim.transport,
      input: { content: good.toString("base64"), format: "msg" },
      requireIsolation: true,
      isolatedModule: TR089,
      transformId: "TR-089",
    });
    expect(ok.output.findings.some((f) => f.predicate === "has_url" || f.objectValue === "https://example.org/x")).toBe(true);

    const bad = Buffer.from(good);
    // Directory entry 1 (__properties_version1.0) declares 4 GiB: refused before allocation, run fails, parent lives.
    bad.writeUInt32LE(0xffffffff, 2 * 512 + 128 + 0x78);
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { content: bad.toString("base64"), format: "msg" },
      requireIsolation: true,
      isolatedModule: TR089,
      transformId: "TR-089",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(String(err.message)).toMatch(/TR-089: stream declares 4294967295 bytes/);
  });

  it("T-ISO-110 (P2-036): concurrent requests across IPC — each finding cites its own request's record", async () => {
    sim.reset();
    const urls = ["https://a.example/", "https://b.example/", "https://c.example/"];
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: urls.join(" ") },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-110",
    });
    expect(result.evidence).toHaveLength(3);
    // Completion order differs from issue order; only the request id ties a record to its request.
    expect(result.evidence[result.evidence.length - 1].url).toBe("https://a.example/");
    for (const f of result.output.findings) {
      const rec = result.evidence.find((e) => e.requestId === f.evidence?.[0]);
      expect(rec?.url).toBe(f.objectValue);
      expect(rec?.body).toBe(f.explanation);
    }
  });

  it("T-ISO-111 (P2-036): a binding to a request the parent never served is refused", async () => {
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://example.com/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-111",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("validation");
    expect(err.message).toMatch(/cites request 41/);
  });

  it("T-ISO-112 (P2-036): a request failure swallowed in the sandbox fails the run", async () => {
    const err = await runTransform(undefined, {
      transport: sim.transport,
      input: { url: "https://big.example/" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-112",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.evidence[0].error).toBeDefined();
  });
});
