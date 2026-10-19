// P3-010: the raw-evidence reading contract — GET /cases/:id/evidence/:evidenceId.
// The evidence viewer needs the raw bytes stored by P1-010 (content-addressed blobs) through
// the same admin boundary as every case route (D-037). Locked (encrypted) cases fail closed
// with the J-17 message and never yield content. Integrity is verified on every blob read
// (T-LED-019), so a missing or corrupt blob is a fail-closed 500, never a partial display.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { casesRouter } from "./cases";
import { openCase } from "@ir/store";

const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN };
const servers: Server[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return { ...init, headers };
}

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "ir-evidence-"));
  roots.push(root);
  const app = createApp(casesRouter(() => root, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, body, text };
  };
  return { call, root };
}

const CREATE = {
  title: "قضية اختبار العارض",
  purpose: "تحقق عقد قراءة الأدلة الخام من مخزن القضية لغرض صحفي موثق",
  legalBasis: "journalism",
};

function json(init: RequestInit, body: unknown): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return { ...init, method: "POST", headers, body: JSON.stringify(body) };
}

/** Stores a real evidence blob in the case via the store itself (the P1-010 path). */
function addEvidence(root: string, caseId: string, bytes: Uint8Array, mime: string): string {
  const dir = path.join(root, caseId);
  const c = openCase(dir, { actor: "test" });
  try {
    const ev = c.addEvidence({
      bytes,
      mime,
      request: { method: "GET", url: "https://example.org/page", headers: {}, status: 200 },
      transformId: "tr-010-reference",
      version: "1.0.0",
    });
    return ev.id;
  } finally {
    c.close();
  }
}

const HTML = new TextEncoder().encode('<!DOCTYPE html><html lang="ar"><body><h1>شبكة مشبوهة</h1><p>تقرير أولي</p></body></html>');

describe("GET /cases/:id/evidence/:evidenceId (P3-010)", () => {
  it("serves the raw evidence as UTF-8 text with its integrity metadata", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as { id: string };
    const evidenceId = addEvidence(root, created.id, HTML, "text/html");
    const res = await call(`/cases/${created.id}/evidence/${evidenceId}`, withAdmin());
    expect(res.status).toBe(200);
    const body = res.body as {
      evidence: { id: string; mime: string; sha256: string; size: number; encoding: string; content: string };
    };
    expect(body.evidence.id).toBe(evidenceId);
    expect(body.evidence.mime).toBe("text/html");
    expect(body.evidence.size).toBe(HTML.length);
    expect(body.evidence.encoding).toBe("utf-8");
    // The raw bytes arrive verbatim — the viewer, not the API, decides how to render.
    expect(body.evidence.content).toBe(new TextDecoder().decode(HTML));
    // Integrity metadata: the content hash of the stored blob (hex sha256).
    expect(body.evidence.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("serves JSON evidence with the same envelope", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as { id: string };
    const bytes = new TextEncoder().encode('{"results": ["a", "b"]}');
    const evidenceId = addEvidence(root, created.id, bytes, "application/json");
    const res = await call(`/cases/${created.id}/evidence/${evidenceId}`, withAdmin());
    expect(res.status).toBe(200);
    const body = res.body as { evidence: { encoding: string; content: string } };
    expect(body.evidence.encoding).toBe("utf-8");
    expect(body.evidence.content).toBe('{"results": ["a", "b"]}');
  });

  it("refuses binary evidence honestly instead of corrupting it (declared limit)", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as { id: string };
    const bytes = new Uint8Array([0, 159, 146, 150, 255, 1, 2]);
    const evidenceId = addEvidence(root, created.id, bytes, "image/png");
    const res = await call(`/cases/${created.id}/evidence/${evidenceId}`, withAdmin());
    expect(res.status).toBe(200);
    const body = res.body as { evidence: { encoding: string; content: string; mime: string; size: number } };
    expect(body.evidence.encoding).toBe("binary");
    expect(body.evidence.content).toBe("");
    expect(body.evidence.mime).toBe("image/png");
    expect(body.evidence.size).toBe(bytes.length);
  });

  it("requires the admin token (401)", async () => {
    const { call } = await start();
    const res = await call("/cases/00000000000000000000000000/evidence/00000000000000000000000000");
    expect(res.status).toBe(401);
  });

  it("404s for an unknown case, an unknown evidence id and a non-ULID id", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as { id: string };
    const evidenceId = addEvidence(root, created.id, HTML, "text/html");
    expect((await call(`/cases/01ARZ3NDEKTSV4RRFFQ69G5FAV/evidence/${evidenceId}`, withAdmin())).status).toBe(404);
    expect((await call(`/cases/${created.id}/evidence/01ARZ3NDEKTSV4RRFFQ69G5FAV`, withAdmin())).status).toBe(404);
    expect((await call(`/cases/${created.id}/evidence/not-a-ulid`, withAdmin())).status).toBe(404);
    expect((await call(`/cases/not-a-ulid/evidence/${evidenceId}`, withAdmin())).status).toBe(404);
  });

  it("fails closed on a locked (encrypted) case — no content, the J-17 message", async () => {
    const { call } = await start();
    const created = (await call("/cases", json(withAdmin(), { ...CREATE, passphrase: "غرض-موثق-طويل-كفاية" }))).body as { id: string };
    const res = await call(`/cases/${created.id}/evidence/01ARZ3NDEKTSV4RRFFQ69G5FAV`, withAdmin());
    expect(res.status).toBe(403);
    const body = res.body as { error: string };
    expect(body.error).toContain("مقفلة");
  });

  it("fails closed (500) when the indexed blob is missing — never partial content", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as { id: string };
    const evidenceId = addEvidence(root, created.id, HTML, "text/html");
    // Corrupt the case directory on purpose: delete the blob the index points at.
    const c = openCase(path.join(root, created.id), { readOnly: true, skipChainCheck: true, actor: "test" });
    const sha = (c.db.prepare("SELECT sha256 FROM evidence WHERE id = ?").get(evidenceId) as { sha256: string }).sha256;
    c.close();
    rmSync(path.join(root, created.id, "blobs", sha.slice(0, 2), sha), { force: true });
    const res = await call(`/cases/${created.id}/evidence/${evidenceId}`, withAdmin());
    expect(res.status).toBe(500);
    const body = res.body as { error: string };
    expect(body.error).toContain("evidence read failed");
  });

  it("refuses evidence larger than the raw-viewer cap (413) with its metadata", async () => {
    const { call, root } = await start();
    const created = (await call("/cases", json(withAdmin(), CREATE))).body as unknown as { id: string };
    // 17 MiB of text — over the 16 MiB raw-viewer cap (declared limit).
    const big = new TextEncoder().encode("x".repeat(17 * 1024 * 1024));
    const evidenceId = addEvidence(root, created.id, big, "text/plain");
    const res = await call(`/cases/${created.id}/evidence/${evidenceId}`, withAdmin());
    expect(res.status).toBe(413);
    const body = res.body as { error: string; size: number };
    expect(body.error).toContain("evidence too large");
    expect(body.size).toBe(big.length);
  });
});
