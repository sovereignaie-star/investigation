import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AiDisabledError,
  createAiGuard,
  createLocalEmbedProvider,
  createLocalProvider,
  estimateAiCost,
  withUsageAudit,
  withEmbedUsageAudit,
  type AiTransport,
  type UsageAuditRecord,
} from "./index.ts";
import { openCase } from "@ir/store";

/**
 * P5-021 — سجل استخدام الذكاء الاصطناعي وتكلفته، ومفتاح تعطيل كامل لكل قضية.
 *
 * كل استدعاء مسجّل في سجل التدقيق بالنموذج والحجم والتكلفة التقديرية (سجل
 * القضية نفسه — P1-017)، والتعطيل يمنع أي استدعاء: الحارس يرفض قبل أي مسار
 * نقل (فشل-مغلق — لا يصل الطلب أصلاً)، والتفعيل يعيدها. والتكلفة التقديرية
 * حتمية معلومة الصيغة: نماذج محلية صفر، وسحابية بجدول معلن.
 */

const servers: Server[] = [];
let requestCount = 0;
const startFakeAi = (port: number, reply: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        requestCount += 1;
        const url = req.url ?? "";
        if (url.includes("/api/embed")) {
          const inputs = (JSON.parse(body).input as string[]) ?? [];
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ model: "nomic-embed-text", embeddings: inputs.map(() => [1, 0, 0]) }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "qwen2.5:7b", message: { role: "assistant", content: reply }, done: true }));
      });
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers.length = 0;
  requestCount = 0;
});

const nodeTransport: AiTransport = {
  async fetch(req) {
    const url = new URL(req.url);
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: req.method, headers: req.headers },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      outgoing.on("error", reject);
      outgoing.end(req.body);
    });
  },
};

const provider = (port: number) => createLocalProvider({ baseUrl: `http://127.0.0.1:${port}`, transport: nodeTransport });
const embedProvider = (port: number) => createLocalEmbedProvider({ baseUrl: `http://127.0.0.1:${port}`, transport: nodeTransport });

describe("P5-021 — سجل الاستخدام والتكلفة", () => {
  it("T-LOG-001: كل استدعاء محادثة مسجّل بالنموذج والحجم والتكلفة التقديرية", async () => {
    await startFakeAi(48534, "جواب النموذج [1].");
    const records: UsageAuditRecord[] = [];
    const audited = withUsageAudit(provider(48534), (record) => records.push(record));
    await audited.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال طويل عن القضية" }] });
    expect(records.length).toBe(1);
    expect(records[0].kind).toBe("chat");
    expect(records[0].model).toBe("qwen2.5:7b");
    expect(records[0].inputChars).toBeGreaterThan(0);
    expect(records[0].outputChars).toBeGreaterThan(0);
    expect(typeof records[0].estimatedCostUsd).toBe("number");
  });

  it("T-LOG-002: استدعاء التضمين مسجّل كذلك", async () => {
    await startFakeAi(49534, "—");
    const records: UsageAuditRecord[] = [];
    const audited = withEmbedUsageAudit(embedProvider(49534), (record) => records.push(record));
    await audited.embed(["نص أول", "نص ثانٍ"]);
    expect(records.length).toBe(1);
    expect(records[0].kind).toBe("embed");
    expect(records[0].model).toBe("nomic-embed-text");
    expect(records[0].estimatedCostUsd).toBe(0);
  });

  it("T-LOG-003: التكلفة التقديرية حتمية معلومة الصيغة — محلي صفر وسحابي بجدول", () => {
    expect(estimateAiCost("qwen2.5:7b", 400, 100)).toBe(0);
    expect(estimateAiCost("nomic-embed-text", 400)).toBe(0);
    // نموذج سحابي بجدول معلن: 0.001$ لكل ألف رمز إدخال و0.002$ لكل ألف رمز إخراج
    const inputTokens = 4000 / 4; // 1000
    const outputTokens = 400 / 4; // 100
    expect(estimateAiCost("gpt-4o-mini", 4000, 400)).toBe((inputTokens / 1000) * 0.00015 + (outputTokens / 1000) * 0.0006);
    expect(estimateAiCost("gpt-4o-mini", 4000, 400)).toBe(estimateAiCost("gpt-4o-mini", 4000, 400));
  });

  it("T-LOG-004: التعطيل يمنع أي استدعاء — لا يصل الطلب أصلاً (فشل-مغلق)", async () => {
    await startFakeAi(50534, "جواب [1].");
    const guard = createAiGuard();
    const guarded = guard.wrap(provider(50534));
    guard.disable();
    await expect(guarded.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال" }] })).rejects.toThrow(AiDisabledError);
    expect(requestCount).toBe(0);
    // التفعيل يعيد الاستدعاء
    guard.enable();
    const response = await guarded.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال" }] });
    expect(response.content).toContain("جواب");
    expect(requestCount).toBe(1);
  });

  it("T-LOG-005: السجل يصعد إلى سجل تدقيق القضية نفسه (P1-017) بالنموذج والحجم والتكلفة", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-ai-log-"));
    try {
      const case_ = openCase(dir, {
        actor: "محقق",
        create: { title: "قضية اختبار", purpose: "اختبار سجل استخدام الذكاء الاصطناعي", legalBasis: "training_simulation" },
      });
      await startFakeAi(51534, "جواب [1].");
      const audited = withUsageAudit(provider(51534), (record) => {
        case_.audit("ai.usage", record.kind, {
          model: record.model,
          inputChars: record.inputChars,
          outputChars: record.outputChars,
          estimatedCostUsd: record.estimatedCostUsd,
        });
      });
      await audited.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال القضية" }] });
      const trail = case_.auditTrail();
      const usageEvents = trail.filter((e) => e.action === "ai.usage");
      expect(usageEvents.length).toBe(1);
      expect(usageEvents[0].detail?.model).toBe("qwen2.5:7b");
      expect(typeof usageEvents[0].detail?.estimatedCostUsd).toBe("number");
      case_.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T-LOG-006: كل استدعاء مسجّل — ثلاثة استدعاءات ثلاثة قيود", async () => {
    await startFakeAi(52534, "جواب [1].");
    const records: UsageAuditRecord[] = [];
    const audited = withUsageAudit(provider(52534), (record) => records.push(record));
    for (let i = 0; i < 3; i += 1) {
      await audited.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: `سؤال ${i}` }] });
    }
    expect(records.length).toBe(3);
  });
});
