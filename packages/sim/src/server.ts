/**
 * P2-008 — deterministic simulation server (`@ir/sim`).
 *
 * A scripted `HttpTransport` that lets tests exercise transform behaviour with
 * fully deterministic responses — success, failure, redirects, timeouts,
 * resource limits, invalid data — with NO external connections. It implements
 * the exact `HttpTransport` port the engine and `runTransform` use, so a
 * transform tested against the sim runs against the same contract it will in
 * production (where the transport is the egress gateway, ADR-08).
 *
 * Determinism: responses are matched by URL (exact or glob) in script order;
 * unmatched URLs fail with a clear error rather than guessing. The clock is
 * injectable, so timeouts and rate-limit waits are reproducible. No real
 * sockets, no DNS, no network — the sim is a pure in-memory function.
 *
 * This is NOT an isolation boundary: it simulates the *network*, not the
 * sandbox. Transform isolation remains P2-005 / G-15.
 */
import { TransportError } from "@ir/engine/transport";
import type { HttpTransport, TransportRequest, TransportResponse } from "@ir/engine/transport";

/** A scripted response for a matching request. */
export interface SimResponse {
  readonly status: number;
  readonly body?: string | Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType?: string;
  /** Delay before the response is delivered (for timeout tests). */
  readonly delayMs?: number;
}

/** A scripted failure for a matching request. */
export interface SimFailure {
  readonly kind:
    | "transport:network"
    | "transport:timeout"
    | "transport:rate-limit"
    | "transport:dns"
    | "transport:ssrf-blocked"
    | "transport:http-error"
    | "transport:cancelled";
  readonly message: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  /** Delay before the failure is raised (for timeout tests). */
  readonly delayMs?: number;
}

/** A scripted redirect: respond with a Location header pointing at another scripted URL. */
export interface SimRedirect {
  readonly status: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Delay before the redirect response is delivered. */
  readonly delayMs?: number;
}

export type SimRule = { readonly match: string | RegExp; readonly response: SimResponse | SimFailure | SimRedirect };

export interface SimServerOptions {
  /** Injectable sleep. Defaults to a real timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface SimServer {
  readonly transport: HttpTransport;
  /** Record of every request the sim received (for assertions). */
  readonly requests: ReadonlyArray<{ readonly method: string; readonly url: string; readonly headers?: Readonly<Record<string, string>> }>;
  /** Number of requests served. */
  readonly requestCount: () => number;
  /** Reset the request log (rules are kept). */
  readonly reset: () => void;
}

function matchUrl(rule: SimRule, url: string): boolean {
  if (typeof rule.match === "string") {
    if (rule.match.includes("*")) {
      const re = new RegExp("^" + rule.match.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return re.test(url);
    }
    return rule.match === url;
  }
  return rule.match.test(url);
}

/**
 * Create a deterministic simulation server from a script of rules. Rules are
 * matched in order; the first match wins. An unmatched URL throws a
 * `TransportError` with kind `transport:network` and a clear message — the sim
 * never guesses a response.
 */
export function createSimServer(rules: SimRule[], opts: SimServerOptions = {}): SimServer {
  const sleep =
    opts.sleep ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(signal.reason);
          },
          { once: true },
        );
      }));
  const requests: Array<{ method: string; url: string; headers?: Readonly<Record<string, string>> }> = [];
  const transport: HttpTransport = {
    async fetch(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      const rule = rules.find((r) => matchUrl(r, req.url));
      if (!rule) {
        throw new TransportError("transport:network", `sim: no rule matches ${req.url}`);
      }
      const r = rule.response;
      if ("kind" in r) {
        if (r.delayMs) await sleep(r.delayMs, signal);
        throw new TransportError(r.kind, r.message, { retryable: r.retryable, retryAfterMs: r.retryAfterMs });
      }
      if ("location" in r) {
        if (r.delayMs) await sleep(r.delayMs, signal);
        return { status: r.status, body: "", headers: { location: r.location, ...r.headers } };
      }
      if (r.delayMs) await sleep(r.delayMs, signal);
      return {
        status: r.status,
        body: r.body ?? "",
        headers: r.headers,
        contentType: r.contentType,
      };
    },
  };
  return {
    transport,
    requests,
    requestCount: () => requests.length,
    reset: () => requests.splice(0),
  };
}
