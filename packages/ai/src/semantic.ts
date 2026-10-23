/**
 * P5-020 — بحث دلالي محلي داخل القضية (تضمينات بنموذج محلي، ADR-17).
 *
 * يعمل بلا شبكة: التضمين عبر مزوّد محلي (Ollama /api/embed) بنقل محقون —
 * لا مسار شبكة مباشر في الحزمة إطلاقاً (ADR-08). والفهرس مشفّر مع القضية:
 * يُسلَّل (JSON) ليُخزن عبر مخزن الحمولات المشفرة (AES-256-GCM تحت مفتاح
 * القضية) فلا يُقرأ نصه الخام من القرص — والبحث حتمي: نفس الاستعلام يعطي
 * نفس الترتيب بالضبط (تشابه جيب التمام على متجهات مستقرة).
 */
import type { AiTransport } from "./index.ts";

/** مزوّد التضمين المحلي — عقد Ollama /api/embed. */
export interface EmbedProvider {
  readonly embed: (texts: readonly string[]) => Promise<readonly number[][]>;
}

export interface LocalEmbedProviderOptions {
  readonly baseUrl: string;
  readonly transport: AiTransport;
  readonly model?: string;
}

/** مزوّد التضمين المحلي — لا شبكة خارجية، نقل محقون فقط (ADR-08/ADR-17). */
export function createLocalEmbedProvider(options: LocalEmbedProviderOptions): EmbedProvider {
  return {
    async embed(texts) {
      const response = await options.transport.fetch({
        url: `${options.baseUrl}/api/embed`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: options.model ?? "nomic-embed-text", input: texts }),
      });
      if (response.status !== 200) {
        throw new Error(`embed: فشل مزوّد التضمين المحلي — HTTP ${response.status}`);
      }
      const parsed = JSON.parse(response.body) as { embeddings?: number[][] };
      if (!Array.isArray(parsed.embeddings) || parsed.embeddings.length !== texts.length) {
        throw new Error("embed: استجابة التضمين لا تحمل متجهات مطابقة للمدخلات");
      }
      return parsed.embeddings.map((v) => [...v]);
    },
  };
}

/** عنصر مفهرس — معرف + نص. */
export interface SearchItem {
  readonly id: string;
  readonly text: string;
}

/** فهرس البحث الدلالي — قابل للتسلسل ليُخزن مشفراً مع القضية. */
export interface SearchIndex {
  readonly ids: readonly string[];
  readonly vectors: readonly (readonly number[])[];
  readonly dims: number;
}

export interface BuildIndexOptions {
  readonly provider: EmbedProvider;
}

export interface SearchResult {
  readonly id: string;
  readonly score: number;
}

export interface SearchOptions {
  readonly provider: EmbedProvider;
}

/** تشابه جيب التمام — حتمي. */
function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** بناء فهرس دلالي من عناصر القضية — متجهات التضمين بترتيبها. */
export async function buildSearchIndex(items: readonly SearchItem[], options: BuildIndexOptions): Promise<SearchIndex> {
  if (items.length === 0) {
    return { ids: [], vectors: [], dims: 0 };
  }
  const vectors = await options.provider.embed(items.map((i) => i.text));
  const dims = vectors[0]?.length ?? 0;
  return { ids: items.map((i) => i.id), vectors, dims };
}

/** بحث دلالي في الفهرس — مرتب تنازلياً بالملاءمة، حتمي الترتيب. */
export async function searchCase(query: string, index: SearchIndex, options: SearchOptions): Promise<readonly SearchResult[]> {
  if (index.ids.length === 0) return [];
  const [queryVector] = await options.provider.embed([query]);
  const scored = index.ids.map((id, i) => ({ id, score: cosine(queryVector, index.vectors[i]) }));
  // ترتيب حتمي: الدرجة تنازلياً ثم المعرف تصاعدياً (كسر التعادل مستقر)
  return [...scored].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/** تسلسل الفهرس — JSON ليُخزن مشفراً مع القضية. */
export function serializeSearchIndex(index: SearchIndex): string {
  return JSON.stringify({ ids: [...index.ids], vectors: index.vectors.map((v) => [...v]), dims: index.dims });
}

/** إعادة بناء الفهرس من التسلسل. */
export function deserializeSearchIndex(serialized: string): SearchIndex {
  const parsed = JSON.parse(serialized) as { ids?: unknown; vectors?: unknown; dims?: unknown };
  if (!Array.isArray(parsed.ids) || !Array.isArray(parsed.vectors) || typeof parsed.dims !== "number") {
    throw new Error("search index: التسلسل لا يطابق مخطط الفهرس");
  }
  return {
    ids: parsed.ids as string[],
    vectors: parsed.vectors as number[][],
    dims: parsed.dims,
  };
}
