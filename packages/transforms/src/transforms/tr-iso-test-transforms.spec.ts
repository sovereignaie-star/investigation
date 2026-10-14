/**
 * T-ISO (P2-005) — hostile and edge-case transforms used ONLY by the isolated
 * runner tests. These are never registered in the transform catalog; they exist
 * so the T-ISO suite can prove the sandbox barriers and the runner's failure
 * handling with real bundled modules.
 */
import { defineTransform } from "../manifest.ts";

const BASE = {
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["http_response"],
  network: { mode: "public", allow: [] },
  secrets: [],
  sensitivity: "normal",
  license: "LC-B",
} as const;

/** TR-ISO-001: a transform that makes one request and returns a finding. */
export const isoOk = defineTransform(
  { ...BASE, id: "TR-101", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    const res = await ctx.http.get(input.url);
    return {
      findings: [
        {
          predicate: "has_http_response",
          evidence: [res.requestId],
          objectType: "http_status",
          objectValue: String(res.status),
          confidence: 1,
          explanation: `status ${res.status}`,
        },
      ],
    };
  },
);

/** TR-102: a transform that tries to open a direct TCP socket (must be blocked). */
export const isoDirectTcp = defineTransform(
  { ...BASE, id: "TR-102", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }) => {
    // Deliberately importing a network module the sandbox must block.
    const net = await import("node:net");
    const result = await new Promise<string>((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port: Number(input.url) });
      s.on("connect", () => {
        s.destroy();
        resolve("connected");
      });
      s.on("error", (e: NodeJS.ErrnoException) => resolve(`error:${e.code ?? e.message}`));
    });
    return {
      findings: [
        {
          predicate: "direct_connect",
          objectType: "text",
          objectValue: result,
          confidence: 1,
          explanation: "direct TCP connect attempt",
        },
      ],
    };
  },
);

/** TR-ISO-003: a transform that reads the host filesystem (must be blocked at "full"). */
export const isoReadFile = defineTransform(
  { ...BASE, id: "TR-103", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async () => {
    // Deliberately reading a file the sandbox must hide.
    const fs = await import("node:fs");
    let content = "unread";
    try {
      content = fs.readFileSync("/etc/hostname", "utf8");
    } catch {
      content = "blocked";
    }
    return {
      findings: [
        {
          predicate: "file_read",
          objectType: "text",
          objectValue: content,
          confidence: 1,
          explanation: "file read attempt",
        },
      ],
    };
  },
);

/** TR-ISO-004: a transform that returns invalid output (must fail validation). */
export const isoInvalidOutput = defineTransform(
  { ...BASE, id: "TR-104", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async () => ({ not: "a valid output" }) as never,
);

/** TR-ISO-005: a transform that throws (must fail with stage "transform"). */
export const isoThrows = defineTransform(
  { ...BASE, id: "TR-105", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async () => {
    throw new Error("iso-transform exploded");
  },
);

/** TR-ISO-006: a transform that loops forever (must be killed by the sandbox timeout). */
export const isoHangs = defineTransform(
  { ...BASE, id: "TR-106", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async () => {
    for (;;) {
      // busy loop — no network, no sleep
    }
  },
);

/** TR-ISO-007: a transform that makes many requests (for rps enforcement). */
export const isoManyRequests = defineTransform(
  { ...BASE, id: "TR-107", limits: { rps: 1, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.http.get(input.url);
    }
    return { findings: [] };
  },
);

/** TR-ISO-008: a transform that leaks a secret into its error (must not appear in evidence). */
export const isoLeaksSecret = defineTransform(
  { ...BASE, id: "TR-108", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async () => {
    throw new Error("the vault secret is SUPER_SECRET_TOKEN_XYZ");
  },
);

/** TR-109: a transform with a small timeoutMs (for the timeout test). */
export const isoShortTimeout = defineTransform(
  { ...BASE, id: "TR-109", limits: { rps: 100, timeoutMs: 1_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    const res = await ctx.http.get(input.url);
    return {
      findings: [
        {
          predicate: "has_http_response",
          evidence: [res.requestId],
          objectType: "http_status",
          objectValue: String(res.status),
          confidence: 1,
          explanation: "status",
        },
      ],
    };
  },
);

/**
 * TR-110 (P2-036): three concurrent requests; each finding cites the request it came from. Used to prove request ids
 * cross the IPC boundary intact and are checked against the parent's records.
 */
export const isoMultiRequest = defineTransform(
  { ...BASE, id: "TR-110", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    const urls = input.url.split(" ");
    const responses = await Promise.all(urls.map((u) => ctx.http.get(u)));
    return {
      findings: responses.map((res, i) => ({
        predicate: "links_to",
        evidence: [res.requestId],
        objectType: "url",
        objectValue: urls[i],
        confidence: 1,
        explanation: res.body,
      })),
    };
  },
);

/** TR-111 (P2-036): cites a request id the parent never served (a forged binding must be refused). */
export const isoForgedEvidence = defineTransform(
  { ...BASE, id: "TR-111", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    await ctx.http.get(input.url);
    return {
      findings: [{ predicate: "links_to", evidence: [41], objectType: "url", objectValue: input.url, confidence: 1, explanation: "x" }],
    };
  },
);

/** TR-112 (P2-036): swallows a failed request and reports "nothing found" (must not become an empty success). */
export const isoSwallowedFailure = defineTransform(
  { ...BASE, id: "TR-112", limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 } },
  async (input: { url: string }, ctx) => {
    await ctx.http.get(input.url).catch(() => undefined);
    return { findings: [] };
  },
);
