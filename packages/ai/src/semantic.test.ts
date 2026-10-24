import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSearchIndex,
  createLocalEmbedProvider,
  searchCase,
  serializeSearchIndex,
  deserializeSearchIndex,
  type AiTransport,
} from "./index.ts";
import { createCaseKey, encryptedBlobStore, unlockCaseKey, type CaseKeyFile } from "@ir/store";

/**
 * P5-020 — بحث دلالي محلي داخل القضية (تضمينات بنموذج محلي).
 *
 * يعمل بلا شبكة (ADR-17): التضمين عبر مزوّد محلي بنقل محقون — لا مسار شبكة
 * مباشر في الحزمة إطلاقاً. والفهرس مشفّر مع القضية: يُخزن عبر مخزن الحمولات
 * المشفرة (AES-256-GCM تحت مفتاح القضية) فلا يُقرأ نصه الخام من القرص،
 * ويُفتح ويُبحث بعد فتح القضية بعبارة المرور.
 */

const ITEMS = [
  { id: "EV-1", text: "النطاق example.test يسجّل سجل A عند العنوان 93.184.216.34 منذ يناير 2020." },
  { id: "EV-2", text: "شهادة TLS للنطاق صادرة من جهة Let's Encrypt وتنتهي في ديسمبر 2026." },
  { id: "EV-3", text: "ورد اسم أحمد عبد الله في مراسلة مسجلة كمراسل النطاق." },
];

/** خادمة تضمين محلية مزيفة — متجهات حتمية تفصل المفاهيم دلالياً. */
const vectorFor = (text: string): number[] => {
  const tls = text.includes("شهادة") || text.includes("TLS") || text.includes("تشفين") ? 1 : 0;
  const person = text.includes("اسم") || text.includes("عبد") ? 1 : 0;
  const domain = text.includes("النطاق") || text.includes("example.test") ? 1 : 0;
  return [tls, person, domain];
};

const servers: Server[] = [];
let lastRequestBody: { model?: string; input?: string[] } | undefined;
const startFakeEmbed = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        lastRequestBody = JSON.parse(body);
        const inputs = (JSON.parse(body).input as string[]) ?? [];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "nomic-embed-text", embeddings: inputs.map(vectorFor) }));
      });
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers.length = 0;
  lastRequestBody = undefined;
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

const provider = (port: number) => createLocalEmbedProvider({ baseUrl: `http://127.0.0.1:${port}`, transport: nodeTransport });

describe("P5-020 — بحث دلالي محلي", () => {
  it("T-SEM-001: يبني فهرساً من عناصر القضية عبر مزوّد التضمين المحلي ويبحث فيه", async () => {
    await startFakeEmbed(42534);
    const index = await buildSearchIndex(ITEMS, { provider: provider(42534) });
    const results = await searchCase("شهادة TLS", index, { provider: provider(42534) });
    expect(results.length).toBe(3);
    expect(results[0].id).toBe("EV-2");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("T-SEM-002: التضمين يطلب النموذج المحلي بعناصر محددة — لا شبكة مباشرة في الحزمة", async () => {
    await startFakeEmbed(43534);
    await buildSearchIndex(ITEMS, { provider: provider(43534) });
    expect(lastRequestBody?.input).toEqual(ITEMS.map((i) => i.text));
    expect(lastRequestBody?.model).toBe("nomic-embed-text");
  });

  it("T-SEM-003: البحث حتمي — نفس الاستعلام يعطي نفس الترتيب بالضبط", async () => {
    await startFakeEmbed(44534);
    const index = await buildSearchIndex(ITEMS, { provider: provider(44534) });
    const first = await searchCase("مراسل النطاق", index, { provider: provider(44534) });
    const second = await searchCase("مراسل النطاق", index, { provider: provider(44534) });
    expect(first).toEqual(second);
  });

  it("T-SEM-004: الفهرس قابل للتسلسل — JSON ذهاباً وإياباً يعطي بحثاً مطابقاً", async () => {
    await startFakeEmbed(45534);
    const index = await buildSearchIndex(ITEMS, { provider: provider(45534) });
    const serialized = serializeSearchIndex(index);
    const restored = deserializeSearchIndex(serialized);
    const a = await searchCase("شهادة", index, { provider: provider(45534) });
    const b = await searchCase("شهادة", restored, { provider: provider(45534) });
    expect(b).toEqual(a);
    expect(JSON.parse(serialized).ids).toEqual(["EV-1", "EV-2", "EV-3"]);
  });

  it("T-SEM-005: الفهرس مشفّر مع القضية — لا نص خام على القرص ويُبحث بعد الفتح", async () => {
    await startFakeEmbed(46534);
    const index = await buildSearchIndex(ITEMS, { provider: provider(46534) });
    const serialized = serializeSearchIndex(index);
    // مخزن الحمولات المشفرة تحت مفتاح القضية (AES-256-GCM)
    const dir = mkdtempSync(join(tmpdir(), "ir-sem-"));
    const caseId = "01JSEMANTICSEARCH0000000000000";
    const { file, key } = createCaseKey(caseId, "عبارة مرور القضية الطويلة");
    const store = encryptedBlobStore(dir, key);
    const ref = store.put(new TextEncoder().encode(serialized));
    // القرص لا يحمل النص الخام — التشفير مطبق (الحمولة مختومة zstd + AES-GCM):
    // كل ملفات القرص تُقرأ ولا يحمل أي منها نص الفهرس
    const allFiles: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(d, entry.name));
        else allFiles.push(join(d, entry.name));
      }
    };
    walk(dir);
    expect(allFiles.length).toBeGreaterThan(0);
    for (const f of allFiles) {
      const raw = readFileSync(f, "utf8");
      expect(raw.includes("example.test"), f).toBe(false);
      expect(raw.includes("EV-1"), f).toBe(false);
    }
    // بعد فتح القضية بعبارة المرور يُقرأ الفهرس ويُبحث
    const unlockedKey = unlockCaseKey(file as CaseKeyFile, "عبارة مرور القضية الطويلة");
    const unlockedStore = encryptedBlobStore(dir, unlockedKey);
    const recovered = unlockedStore.get(ref.sha256);
    const restored = deserializeSearchIndex(new TextDecoder().decode(recovered ?? new Uint8Array()));
    const results = await searchCase("شهادة TLS", restored, { provider: provider(46534) });
    expect(results[0].id).toBe("EV-2");
  });

  it("T-SEM-006: الملاءمة الدلالية — الأقرب مفهوماً يتصدر مهما اختلف اللفظ", async () => {
    await startFakeEmbed(47534);
    const index = await buildSearchIndex(ITEMS, { provider: provider(47534) });
    // «تشفين» لفظ مختلف عن «شهادة TLS» لكن المتجه يفصل المفاهيم دلالياً
    const results = await searchCase("تشفين", index, { provider: provider(47534) });
    expect(results[0].id).toBe("EV-2");
  });
});
