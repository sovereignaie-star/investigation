import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
  chat,
  createCloudProvider,
  createLocalProvider,
  resolveProvider,
  type AiHttpRequest,
  type AiHttpResponse,
  type AiTransport,
} from "./index.ts";

/**
 * P5-012 — `@ir/ai`: واجهة مزوّد ومحلي افتراضياً.
 *
 * السيادة أولاً: الافتراضي نموذج محلي (عقد Ollama المحلي) بلا شبكة خارجية
 * وبلا مفتاح؛ السحابي اختياري بموافقة صريحة لكل قضية — يُرفض صريحاً لا صامتاً
 * عند غيابها، ولا يُسقط أبداً إلى السحابي عند فشل المحلي (لا احتياط صامت).
 *
 * الحزمة تنسيق صرف: لا مسار شبكة مباشر (ADR-08) — النقل يُحقن. ملفات
 * الاختبار وحدها تفتح منافذ محلية (مسموح وموثق في حارس no-direct-network).
 * «يعمل مع نموذج محلي» يُثبت ضد عقد Ollama نفسه (خادم اختبار محلي يتكلم
 * البروتوكول) لا ضد بديل مختلق.
 */

const OLLAMA_CHAT_RESPONSE = {
  model: "qwen2.5:7b",
  created_at: "2026-01-01T00:00:00Z",
  message: { role: "assistant", content: "النطاق example.test مسجل منذ 2020." },
  done: true,
};

const servers: Server[] = [];
const startFakeOllama = (port = 11434, status = 200): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        if (req.url === "/api/chat" && status === 200) {
          const parsed = JSON.parse(body) as { model?: string };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...OLLAMA_CHAT_RESPONSE, request_model: parsed.model }));
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "simulated failure" }));
      });
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers.length = 0;
});

/** نقل عقدة محلي للحقن — في الاختبار فقط (منفذ محلي مسموح في ملفات الاختبار). */
const nodeTransport: AiTransport = {
  async fetch(req: AiHttpRequest): Promise<AiHttpResponse> {
    const url = new URL(req.url);
    return new Promise<AiHttpResponse>((resolve, reject) => {
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

describe("P5-012 — الافتراضي محلي", () => {
  it("T-AI-001: بلا تهيئة — المزوّد المحلي، لا سحابي ولا شبكة خارجية", () => {
    const provider = resolveProvider({}, nodeTransport);
    expect(provider.id).toBe("local-ollama");
    expect(provider.isLocal).toBe(true);
  });

  it("T-AI-002: يعمل مع نموذج محلي — عقد Ollama حرفياً (خادم اختبار محلي بالبروتوكول نفسه)", async () => {
    await startFakeOllama();
    const provider = createLocalProvider({ baseUrl: "http://127.0.0.1:11434", transport: nodeTransport });
    const response = await provider.chat({
      model: "qwen2.5:7b",
      messages: [{ role: "user", content: "لخص حالة النطاق example.test" }],
    });
    expect(response.content).toContain("example.test");
    expect(response.model).toBe("qwen2.5:7b");
  });

  it("T-AI-003: استدعاء الدالة الموحدة chat يعمل عبر المزوّد المحلي", async () => {
    await startFakeOllama(21434);
    const response = await chat(
      { model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال" }] },
      { provider: createLocalProvider({ baseUrl: "http://127.0.0.1:21434", transport: nodeTransport }) },
    );
    expect(response.content.length).toBeGreaterThan(0);
  });

  it("T-AI-003b: الحزمة بلا نقل محقون ترفض صريحاً — لا مسار شبكة خفياً (ADR-08)", async () => {
    await expect(chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "سؤال" }] })).rejects.toThrow(
      /no transport injected|AiTransport/i,
    );
  });
});

describe("P5-012 — السحابي بموافقة صريحة فقط", () => {
  it("T-AI-004: مزوّد سحابي بلا موافقة صريحة يُرفض صريحاً — لا صمت ولا تسريب", async () => {
    const provider = createCloudProvider({
      apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:18999",
      transport: nodeTransport,
      consent: undefined,
    });
    await expect(provider.chat({ model: "x", messages: [{ role: "user", content: "س" }] })).rejects.toThrow(/موافقة|consent/i);
  });

  it("T-AI-005: مزوّد سحابي بموافقة صريحة يعمل — والموافقة تُطبع في كل استدعاء", async () => {
    const provider = createCloudProvider({
      apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:18999",
      transport: nodeTransport,
      consent: { caseRef: "case-001", grantedBy: "investigator-1", purpose: "تلخيص القضية" },
    });
    const calls: string[] = [];
    const cloud = await new Promise<Server>((resolve, reject) => {
      const s = createServer((req, res) => {
        calls.push(String(req.headers["x-consent-case"]));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ملخص" } }], model: "cloud-x", usage: { total_tokens: 12 } }));
      });
      s.once("error", reject);
      s.listen(18999, "127.0.0.1", () => resolve(s));
    });
    const response = await provider.chat({
      model: "cloud-x",
      messages: [{ role: "user", content: "لخص" }],
    });
    expect(response.content).toBe("ملخص");
    expect(calls).toEqual(["case-001"]);
    cloud.close();
  });

  it("T-AI-006: فشل المحلي لا يُسقط أبداً إلى السحابي — خطأ مصنّف لا احتياط صامت", async () => {
    const provider = createLocalProvider({ baseUrl: "http://127.0.0.1:1", transport: nodeTransport }); // منفذ مغلق
    await expect(provider.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "س" }] })).rejects.toThrow(/provider|local/i);
  });

  it("T-AI-007: أخطاء HTTP من المزوّد مصنّفة بلا ابتلاع — لا تمر صامتة", async () => {
    const provider = createLocalProvider({ baseUrl: "http://127.0.0.1:31434", transport: nodeTransport });
    await startFakeOllama(31434, 500);
    await expect(provider.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "س" }] })).rejects.toThrow(/500|HTTP/i);
  });
});
