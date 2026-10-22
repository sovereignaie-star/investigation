// P4-020 red-first: the ATT&CK matrix route serves the case's technique-tagged
// claims joined with the LOCAL frozen STIX knowledge (offline by construction —
// the knowledge is a generated module bundled into the server). Every matrix
// entry carries the claim AND that claim's evidence ids ("كل وسم تقنية يحيل إلى
// الملاحظة التي اقتضته"); unknown technique ids are reported, never dropped; a
// locked case fails closed with the J-17 message.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { casesRouter } from "./cases";
import { openCase, type Case } from "@ir/store";
import { manualClock, seededRandom, ulidFactory } from "@ir/core";

const clock = manualClock("2026-10-22T12:00:00.000Z");
const ulid = ulidFactory(clock, seededRandom(3));
const id = () => ulid();

const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN };
const servers: Server[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "ir-attack-matrix-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  const app = createApp(casesRouter(() => root, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
    const res = await fetch(base + p, { ...init, headers });
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
  title: "قضية مصفوفة ATT&CK",
  purpose: "تتبع كيانات عامة لاختبار مصفوفة التقنيات",
  legalBasis: "due_diligence",
} as const;

/** Technique-tagged claims: uses_technique with the technique id as the value, each with an observation on evidence. */
function populate(c: Case): Map<string, string> {
  const ent = { id: id(), type: "domain", canonicalKey: "domain:example.com", labels: { en: "example.com" }, props: {} };
  c.append("entity.added", ent);
  const evidenceByTechnique = new Map<string, string>();
  for (const technique of ["T1566", "T1071.004", "CAPEC-112", "D3-AM", "T9999"]) {
    const claimId = id();
    const evidenceId = id(); // معرف دليل حقيقي بصيغة ULID — المخطط يرفض غير ذلك
    evidenceByTechnique.set(technique, evidenceId);
    c.append("evidence.stored", {
      id: evidenceId,
      kind: "url",
      title: `دليل ${technique}`,
      sha256: "0".repeat(64),
      storedAt: "2026-10-22T12:00:00.500Z",
    });
    c.append("claim.added", {
      id: claimId,
      subjectId: ent.id,
      predicate: "uses_technique",
      value: technique,
      confidence: 0.8,
      explanation: "وسم تقنية من اختبار المصفوفة",
    });
    c.append("observation.added", {
      id: id(),
      claimId,
      transformId: "tr-manual",
      evidenceId,
      observedAt: "2026-10-22T12:00:01.000Z",
      kind: "positive",
    });
  }
  return evidenceByTechnique;
}

describe("P4-020 case ATT&CK matrix (بيانات STIX محلية — بلا شبكة)", () => {
  it("serves the case matrix from the frozen local knowledge, every entry carrying its claim and evidence", async () => {
    const { call, root } = await start();
    const caseId = id();
    const dir = path.join(root, caseId);
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    const evidenceByTechnique = populate(c);
    c.close();
    const listed = (await call("/cases")).body as { cases: Array<{ id: string }> };
    const realId = listed.cases[0]?.id;
    expect(realId).toBeTruthy();

    const res = await call(`/cases/${realId}/attack-matrix`);
    expect(res.status).toBe(200);
    const matrix = res.body as {
      tactics: {
        tactic: string;
        techniques: { techniqueId: string; name: string; claims: { claimId: string; evidenceIds: string[] }[] }[];
      }[];
      capec: { techniqueId: string }[];
      d3fend: { techniqueId: string }[];
      unknownTechniques: string[];
    };
    // التكتيكان: initial-access (T1566) وcommand-and-control (T1071.004)
    expect(matrix.tactics.map((t) => t.tactic).sort()).toEqual(["command-and-control", "initial-access"]);
    const c2 = matrix.tactics.find((t) => t.tactic === "command-and-control");
    expect(c2?.techniques).toHaveLength(1);
    expect(c2?.techniques[0]).toMatchObject({ techniqueId: "T1071.004", name: "DNS" });
    // الوسم يحيل إلى الملاحظة: الادعاء وأدلته
    expect(c2?.techniques[0].claims[0]?.evidenceIds).toEqual([evidenceByTechnique.get("T1071.004")]);
    expect(matrix.capec.map((x) => x.techniqueId)).toEqual(["CAPEC-112"]);
    expect(matrix.d3fend.map((x) => x.techniqueId)).toEqual(["D3-AM"]);
    // المجهول مُبلَّغ لا مسكوت عنه
    expect(matrix.unknownTechniques).toEqual(["T9999"]);
  });

  it("a case with no technique claims serves an honestly empty matrix", async () => {
    const { call, root } = await start();
    const caseId = id();
    const dir = path.join(root, caseId);
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    c.append("entity.added", { id: id(), type: "domain", canonicalKey: "domain:x.example", labels: { en: "x" }, props: {} });
    c.close();
    const listed = (await call("/cases")).body as { cases: Array<{ id: string }> };
    const res = await call(`/cases/${listed.cases[0]?.id}/attack-matrix`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tactics: [], capec: [], d3fend: [], unknownTechniques: [] });
  });

  it("a locked case fails closed with the J-17 message", async () => {
    const { call, root } = await start();
    const caseId = id();
    const dir = path.join(root, caseId);
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE }, passphrase: "سر-قضية-مقفلة" });
    populate(c);
    c.close();
    const listed = (await call("/cases")).body as { cases: Array<{ id: string }> };
    const res = await call(`/cases/${listed.cases[0]?.id}/attack-matrix`);
    expect(res.status).toBe(403);
    expect(res.text).toContain("مقفلة");
  });

  it("an unknown case id is 404", async () => {
    const { call } = await start();
    const res = await call("/cases/missing/attack-matrix");
    expect(res.status).toBe(404);
  });
});
