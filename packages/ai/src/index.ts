/**
 * P5-012 — `@ir/ai`: واجهة مزوّد موحدة، محلي افتراضياً.
 *
 * السيادة أولاً (الخارطة: «نموذج محلي افتراضياً (مثلاً عبر Ollama)، ومزوّد
 * سحابي اختياري بموافقة صريحة لكل قضية»): الافتراضي هو المزوّد المحلي بعقد
 * Ollama — بلا مفتاح وبلا شبكة خارجية. هذه الحزمة تنسيق صرف: لا تحتوي أي مسار
 * شبكة مباشر (ADR-08 — حارس no-direct-network)؛ النقل يُحقن عبر `AiTransport`
 * (المستدعي يبنيه: نقل عقدة محلي لـ Ollama، أو نقل بوابة الخروج للسحابي).
 *
 * السحابي يُرفض صريحاً بلا موافقة موثقة لكل قضية، وفشل المحلي يُصنَّف خطأً
 * ولا يُسقط أبداً إلى السحابي (لا احتياط صامت — السيادة لا تُفوض عند التعثر).
 */

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
}

export interface ChatResponse {
  readonly content: string;
  readonly model: string;
  readonly providerId: string;
}

export interface ProviderError extends Error {
  readonly providerId: string;
  readonly kind: "transport" | "http" | "consent";
  readonly status?: number;
}

class ProviderErrorImpl extends Error implements ProviderError {
  readonly providerId: string;
  readonly kind: ProviderError["kind"];
  readonly status?: number;
  constructor(providerId: string, kind: ProviderError["kind"], message: string, status?: number) {
    super(`${providerId}: ${message}`);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.kind = kind;
    this.status = status;
  }
}

const providerError = (providerId: string, kind: ProviderError["kind"], message: string, status?: number): ProviderError =>
  new ProviderErrorImpl(providerId, kind, message, status);

/* ------------------------------------------------------------- النقل المحقون */

/**
 * نقل HTTP محقون — الحزمة بلا مسار شبكة مباشر (ADR-08). المستدعي يبني النقل:
 * عقدة محلية لـ Ollama (127.0.0.1)، أو بوابة الخروج للسحابي.
 */
export interface AiTransport {
  fetch(request: AiHttpRequest): Promise<AiHttpResponse>;
}

export interface AiHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface AiHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** استدعاء النقل بتصنيف أخطاء صريح — لا ابتلاع. */
async function postJson(
  providerId: string,
  transport: AiTransport,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: AiHttpResponse;
  try {
    response = await transport.fetch({ url, method: "POST", headers, body: JSON.stringify(body) });
  } catch (cause) {
    throw providerError(providerId, "transport", cause instanceof Error ? cause.message : "transport failure");
  }
  if (response.status < 200 || response.status >= 300) {
    throw providerError(providerId, "http", `HTTP ${response.status} ${response.body.slice(0, 120)}`, response.status);
  }
  try {
    return JSON.parse(response.body) as unknown;
  } catch (cause) {
    throw providerError(providerId, "http", cause instanceof Error ? cause.message : "invalid JSON response");
  }
}

/* ------------------------------------------------------------- المحلي */

export interface LocalProviderOptions {
  /** عنوان خادم Ollama — الافتراضي المحلي المعياري. */
  readonly baseUrl?: string;
  readonly transport: AiTransport;
}

/**
 * المزوّد المحلي — عقد Ollama حرفياً (POST /api/chat). لا مفتاح ولا شبكة
 * خارجية؛ فشله خطأ مصنّف ولا احتياط سحابياً أبداً.
 */
export function createLocalProvider(options: LocalProviderOptions): AiProvider {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
  return {
    id: "local-ollama",
    isLocal: true,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const payload = (await postJson(
        "local-ollama",
        options.transport,
        `${baseUrl}/api/chat`,
        {},
        {
          model: request.model,
          messages: request.messages,
          ...(request.temperature !== undefined ? { options: { temperature: request.temperature } } : {}),
          stream: false,
        },
      )) as { message?: { content?: string }; model?: string };
      const content = payload.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw providerError("local-ollama", "http", "empty or missing assistant message");
      }
      return { content, model: payload.model ?? request.model, providerId: "local-ollama" };
    },
  };
}

/* ------------------------------------------------------------ السحابي */

/** موافقة صريحة موثقة لكل قضية — لا سحابي بلاها. */
export interface CloudConsent {
  readonly caseRef: string;
  readonly grantedBy: string;
  readonly purpose: string;
}

export interface CloudProviderOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly transport: AiTransport;
  readonly consent?: CloudConsent;
}

/**
 * المزوّد السحابي — اختياري بموافقة صريحة لكل قضية: بلا موافقة يُرفض كل
 * استدعاء صريحاً (فشل-مغلق)، وبها تُطبع الموافقة في كل استدعاء (تتبع).
 */
export function createCloudProvider(options: CloudProviderOptions): AiProvider {
  const consent = options.consent;
  return {
    id: "cloud",
    isLocal: false,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      if (consent === undefined) {
        throw providerError("cloud", "consent", "لا استدعاء سحابياً بلا موافقة صريحة موثقة لكل قضية");
      }
      const payload = (await postJson(
        "cloud",
        options.transport,
        `${options.baseUrl}/v1/chat/completions`,
        {
          authorization: `Bearer ${options.apiKey}`,
          "x-consent-case": consent.caseRef,
          "x-consent-purpose": encodeURIComponent(consent.purpose),
        },
        {
          model: request.model,
          messages: request.messages,
        },
      )) as { choices?: { message?: { content?: string } }[]; model?: string };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw providerError("cloud", "http", "empty or missing completion");
      }
      return { content, model: payload.model ?? request.model, providerId: "cloud" };
    },
  };
}

/* ------------------------------------------------- الحل والاستدعاء الموحد */

export interface ProviderConfig {
  readonly local?: Omit<LocalProviderOptions, "transport">;
  readonly cloud?: Omit<CloudProviderOptions, "transport">;
  /** طلب سحابي صريح — الافتراضي كاذب (محلي دوماً). */
  readonly preferCloud?: boolean;
}

/** حل المزوّد: الافتراضي المحلي؛ السحابي فقط بطلب صريح وموافقة موثقة. */
export function resolveProvider(config: ProviderConfig, transport: AiTransport): AiProvider {
  if (config.preferCloud === true && config.cloud !== undefined) {
    return createCloudProvider({ ...config.cloud, transport });
  }
  return createLocalProvider({ ...config.local, transport });
}

export interface ChatOptions {
  readonly provider?: AiProvider;
}

/** الاستدعاء الموحد — عبر مزوّد محدد أو المحلول من التهيئة (محلي افتراضياً). */
export async function chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResponse> {
  const provider = options.provider ?? resolveProvider({}, nodeRejectTransport);
  return provider.chat(request);
}

/** نقل بلا مسار شبكة — يرفض صريحاً (لا شبكة افتراضية خفية في الحزمة). */
const nodeRejectTransport: AiTransport = {
  async fetch(): Promise<AiHttpResponse> {
    throw new Error("no transport injected — @ir/ai carries no network path (ADR-08); the caller must provide AiTransport");
  },
};

import type { ChatMessage } from "./summarize-types.ts";

export { summarizeEvidence } from "./summarize.ts";
export type { SummarizeResult, SummaryClaim, SummarizeOptions } from "./summarize.ts";
export { detectInjection, buildSummarizeMessages, neutralizeMarkers } from "./injection.ts";
export { suggestNextActions, PERSONAL_ENTITY_TYPES } from "./next-action.ts";
export { answerCaseQuestion } from "./qa.ts";
export type { QaResult, QaClaim, QaOptions } from "./qa.ts";
export type {
  CaseEntity,
  CaseSnapshot,
  NextAction,
  NextActionResult,
  NextActionOptions,
  VerifiedSuggestion,
  RejectedSuggestion,
} from "./next-action.ts";
export { suggestEntities, ENTITY_TYPES } from "./extract.ts";
export type { EntitySuggestion, EntityType, ExtractResult, ExtractOptions } from "./extract.ts";
export type { InjectionCheck } from "./injection.ts";
export type { ChatMessage, EvidenceStatement } from "./summarize-types.ts";

export interface AiProvider {
  readonly id: string;
  readonly isLocal: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
