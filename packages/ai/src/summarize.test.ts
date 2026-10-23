import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createLocalProvider, summarizeEvidence, type AiTransport, type EvidenceStatement } from "./index.ts";

/**
 * P5-013 — التلخيص المقيد بالأدلة والتحقق منه.
 *
 * القاعدة: التلخيص مقيد بالأدلة — النموذج يُعلَّم أن كل جملة تحمل إحالة، ثم
 * يُتحقق من الناتج تحققاً حتمياً مستقلاً: كل جملة خلاصة يجب أن تحمل إحالة
 * قائمة وأن يكون مضمونها مستنداً إلى الدليل المُحال إليه (تراكب كلمات
 * المحتوى) — الجمل غير المدعومة تُقاس وتُرفض، لا أن تمر صامتة. معيار القبول:
 * ≤ 2% غير مدعوم في الخلاصة السليمة، والمهلوس يُكشف.
 */

const EVIDENCE: EvidenceStatement[] = [
  {
    text: "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 منذ يناير 2020.",
    evidenceId: "EV-1",
  },
  {
    text: "صفحة النطاق الرئيسية وثّقت بلقطة أرشيفية كاملة بتاريخ 2026-10-01.",
    evidenceId: "EV-2",
  },
  {
    text: "شهادة TLS للنطاق صادرة من جهة Let's Encrypt وتنتهي في ديسمبر 2026.",
    evidenceId: "EV-3",
  },
];

/** خلاصة سليمة: كل جملة بإحالة وبمضمون مستند إلى الدليل. */
const GOOD_SUMMARY =
  "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 [1]. " +
  "الصفحة الرئيسية موثقة بلقطة أرشيفية بتاريخ 2026-10-01 [2]. " +
  "شهادة TLS صادرة من Let's Encrypt وتنتهي في ديسمبر 2026 [3].";

let server: Server | undefined;
const startFakeOllama = (port: number, reply: string): void => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: "qwen2.5:7b", message: { role: "assistant", content: reply }, done: true }));
  }).listen(port, "127.0.0.1");
};

afterEach(() => {
  server?.close();
  server = undefined;
});

/** نقل عقدة محلي للحقن — في الاختبار فقط. */
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

describe("P5-013 — التلخيص المقيد بالأدلة", () => {
  it("T-SUM-001: يُنتج خلاصة مقيدة بالأدلة عبر المزوّد المحلي — بتعليم صريح لكل جملة بإحالة", async () => {
    startFakeOllama(41434, GOOD_SUMMARY);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(41434) });
    expect(result.claims.length).toBe(3);
    expect(result.unsupported).toHaveLength(0);
    expect(result.unsupportedRatio).toBeLessThanOrEqual(0.02);
  });

  it("T-SUM-002: خلاصة سليمة — ≤ 2% غير مدعوم (المعيار)", async () => {
    startFakeOllama(42434, GOOD_SUMMARY);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(42434) });
    expect(result.unsupportedRatio).toBeLessThanOrEqual(0.02);
    expect(result.ok).toBe(true);
  });

  it("T-SUM-003: جملة بلا إحالة إطلاقاً — مهلوس يُكشف ويُقاس لا أن يمر صامتاً", async () => {
    const hallucinated =
      "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 [1]. " +
      "المالك الحقيقي للنطاق شركة وهمية مملوكة لجهة أجنبية مجهولة. " +
      "شهادة TLS صادرة من Let's Encrypt وتنتهي في ديسمبر 2026 [3].";
    startFakeOllama(43434, hallucinated);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(43434) });
    expect(result.ok).toBe(false);
    expect(result.unsupported.length).toBeGreaterThanOrEqual(1);
    expect(result.unsupportedRatio).toBeGreaterThan(0.02);
  });

  it("T-SUM-004: إحالة إلى دليل غير موجود ([9]) — غير مدعوم", async () => {
    const broken = "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 [9].";
    startFakeOllama(44434, broken);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(44434) });
    expect(result.ok).toBe(false);
    expect(result.unsupported.length).toBe(1);
  });

  it("T-SUM-005: جملة تحمل إحالة صحيحة لكن مضمونها مختلق (لا سند في الدليل) — تُكشف", async () => {
    const forged = "النطاق example.test مرتبط بشبكة بوتات عالمية لأغراض تجارة مخدرات [1].";
    startFakeOllama(45434, forged);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(45434) });
    expect(result.ok).toBe(false);
    expect(result.unsupported.length).toBe(1);
  });

  it("T-SUM-006: جملة خلاصة بعبارات الدليل نفسها بلا إحالة مقبولة النحو تُعد مدعومة — التحقق يقيس السند لا الصياغة", async () => {
    const paraphrase = "سجل A للنطاق عند 93.184.216.34 منذ يناير 2020 [1]. " + "لقطة أرشيفية كاملة للصفحة الرئيسية بتاريخ 2026-10-01 [2].";
    startFakeOllama(46434, paraphrase);
    const result = await summarizeEvidence(EVIDENCE, { provider: provider(46434) });
    expect(result.ok).toBe(true);
    expect(result.unsupportedRatio).toBeLessThanOrEqual(0.02);
  });
});
