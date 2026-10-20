// @vitest-environment jsdom
/**
 * P3-015 hardening (post-review): the COLD-BROWSER flow of «فتح قضية بعد إعادة
 * التشغيل», as an interaction test — the earlier static-render and server tests
 * prove the data path, but the acceptance is a user flow: a fresh browser
 * session (no token, empty cache) starts at an honest auth error, entering the
 * admin token loads the saved list, and clicking open loads the case's own
 * projection into the workbench. Also guards the auth-getter wiring: the token
 * is one memory-only ref for the whole session and no page navigation
 * (Cases → Workbench) may shadow it (D-033/D-037).
 *
 * Red-first: written before the fixes — on the pre-fix tree this fails at the
 * first honest step (the unauthorized list renders as a fake «no saved cases»
 * and entering the token does not refetch the list), which is the defect.
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkbenchPage } from "../WorkbenchPage";

/** The shared memory-only token module under test — its getter reads this ref. */
import { useAdminToken } from "../../utils/adminToken";

// jsdom lacks matchMedia (sonner's Toaster reads the theme); React 19's act needs the flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

const ACTIVE_CASE = {
  id: "01M58XF9ZKJT50S8E8JYXF6P3X",
  title: "شبكة تجارة إلكترونية مشبوهة",
  purpose: "تتبع شبكة شركات لتحقيق صحفي موثق الغرض",
  legalBasis: "journalism",
  createdAt: "2026-10-10T12:00:00.000Z",
  archivedAt: null,
  sensitivity: "standard",
  tags: [],
  encrypted: false,
  status: "active",
  lastActivityAt: "2026-10-11T12:00:00.000Z",
};

const PROJECTION = {
  seq: 4,
  graph: {
    nodes: [
      {
        id: "n1",
        type: "domain",
        canonicalKey: "domain:example.com",
        labels: { ar: "example.com" },
        props: {},
        aliases: [],
        attributes: [],
        observations: { positive: 0, negative: 0, error: 0 },
        evidenceIds: [],
      },
    ],
    edges: [],
  },
  table: [],
  coverage: {},
  networkLog: {},
  counts: { entities: 1, nodes: 1, claims: 0, edges: 0, observations: 0, evidence: 0, merges: 0, notes: 0 },
  sha256: "a".repeat(64),
};

let root: Root | null = null;
const container = document.createElement("div");

/** Renders an element into the jsdom container inside a fresh QueryClient. */
function render(element: React.ReactElement): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(QueryClientProvider, { client }, element));
  });
  return client;
}

beforeEach(() => {
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
  while (container.firstChild) container.removeChild(container.firstChild);
});

/** Sets an input's value the way React's onChange hears it (native setter + input event). */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The raw fetch of the app under a token-aware mock: 401 without the header, the case data with it. */
const fetchMock = (calls: { url: string; auth: boolean }[]) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, auth: Boolean(init?.headers && new Headers(init.headers).get("authorization")) });
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/cases") && !url.includes("?")) {
      return calls[calls.length - 1].auth ? json(200, { cases: [ACTIVE_CASE] }) : json(401, { error: "unauthorized" });
    }
    if (url.endsWith(`/api/cases/${ACTIVE_CASE.id}/projection`)) {
      return calls[calls.length - 1].auth ? json(200, PROJECTION) : json(401, { error: "unauthorized" });
    }
    return json(404, { error: "unknown" });
  });

describe("P3-015 cold-browser flow — فتح قضية بعد إعادة التشغيل (تفاعلي)", () => {
  it("fresh session: honest 401 state, then entering the token loads the list, and open loads the case's own graph", async () => {
    vi.stubGlobal("fetch", fetchMock([]));
    try {
      // Cold start: no token, empty cache — the surface must NOT dress the 401 as «no saved cases».
      render(React.createElement(WorkbenchPage));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(container.textContent).not.toContain("لا قضايا محفوظة بعد");
      expect(container.textContent).toContain("رمز الإدارة");

      // Enter the admin token (memory-only) — the list must refetch with it.
      const tokenInput = container.querySelector<HTMLInputElement>('[data-testid="saved-token"]');
      expect(tokenInput).not.toBeNull();
      await act(async () => {
        setInputValue(tokenInput as HTMLInputElement, "admin-token-123");
        await new Promise((r) => setTimeout(r, 10));
      });

      // The saved case is now listed with an open action.
      expect(container.textContent).toContain(ACTIVE_CASE.title);
      const openButton = container.querySelector<HTMLButtonElement>(`[data-testid="open-case-${ACTIVE_CASE.id}"]`);
      expect(openButton).not.toBeNull();

      // Open it — the case's own projection renders in the workbench (graph + banner).
      await act(async () => {
        if (openButton === null) throw new Error("open button missing");
        openButton.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(container.querySelector('[data-testid="opened-case-banner"]')).not.toBeNull();
      expect(container.textContent).toContain("domain:example.com");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the memory-only token survives page navigation: no page's mount may shadow the shared auth getter", async () => {
    // The getter is installed once (module load) and always reads the shared ref —
    // a page that mounts later must not be able to replace it with its own dead ref.
    // Verified behaviorally: after a component using the shared hook sets the token,
    // a generated-client call carries the Authorization header.
    function TokenHolder(): React.ReactElement {
      const [, setToken] = useAdminToken();
      React.useEffect(() => {
        setToken("admin-token-123");
      }, [setToken]);
      return React.createElement("span", null, "holder");
    }
    render(React.createElement(TokenHolder));
    const authHeaders: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        authHeaders.push(new Headers(init?.headers).get("authorization"));
        return new Response(JSON.stringify({ cases: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    try {
      const { listCases } = await import("@workspace/api-client-react");
      await act(async () => {
        await listCases();
      });
      expect(authHeaders).toHaveLength(1);
      // The generated client sent the SHARED session token — the getter was not
      // shadowed by the component's mount (the app's one-ref contract, D-033/D-037).
      expect(authHeaders[0]).toBe("Bearer admin-token-123");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
