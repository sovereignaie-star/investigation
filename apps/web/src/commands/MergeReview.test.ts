// @vitest-environment jsdom
/**
 * P4-005 (UC-11) red-first: the MergeReview panel — the merge-review write surface.
 * The contract these tests pin (written BEFORE the panel existed; on the pre-feature
 * tree they fail to import, which is the defect — no merge-review surface at all):
 *
 * - suggestions load on the panel's EXPLICIT open (no background job): the panel
 *   fetches the pinned model's suggestions and the merge log through the REAL
 *   generated client (fetch-mocked at the network level, like commandSurfaces);
 * - the score is displayed as «درجة مطابقة» — NEVER as a confidence;
 * - a suggestion shows its reasons and the survivor choice; accepting posts
 *   entityIds + survivorId + the echoed modelVersion/caseVersion (the server never
 *   trusts client-derived reasons) and ends with a refreshed projection (onSaved);
 * - the merge log carries the revert button; a reverted merge shows the badge
 *   (the revert is idempotent server-side);
 * - the empty state is honest: no suggestions => «لا اقتراحات», not a fake list.
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MergeReview } from "./MergeReview";

const NODE_A = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const NODE_B = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const CASE_ID = "01CCCCCCCCCCCCCCCCCCCCCCCC";
const MERGE_ID = "01MMMMMMMMMMMMMMMMMMMMMMMM";

const SUGGESTIONS_BODY = {
  modelVersion: "er-model/1",
  caseVersion: 5,
  suggestions: [
    {
      aId: NODE_A,
      bId: NODE_B,
      score: 7.28,
      decision: "strong",
      reasons: [{ feature: "name", weight: 2.46, detail: "تطابق الاسم" }],
    },
  ],
};

const MERGES_BODY = (reverted: boolean) => ({
  merges: [
    {
      seq: 6,
      id: MERGE_ID,
      entityIds: [NODE_A, NODE_B],
      survivorId: NODE_A,
      reasons: ["دمج مقبول بشرياً (UC-11)"],
      decidedBy: "web",
      decidedAt: "2026-10-21T10:00:00Z",
      reverted,
    },
  ],
});

let root: Root | null = null;
const container = document.createElement("div");

const calls: Array<{ url: string; method: string; body?: unknown }> = [];
let suggestionsBody = SUGGESTIONS_BODY;
let mergesReverted = false;
let acceptStatus = 201;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/merge-suggestions")) return json(200, suggestionsBody);
  if (url.includes(`/merges/${MERGE_ID}/revert`)) {
    mergesReverted = true;
    return json(200, MERGES_BODY(true).merges[0]);
  }
  if (url.includes("/merges") && method === "POST") {
    if (acceptStatus !== 201) return json(acceptStatus, { error: "stale" });
    mergesReverted = false;
    return json(201, { ...MERGES_BODY(false).merges[0], seq: 7 });
  }
  if (url.endsWith("/merges")) return json(200, MERGES_BODY(mergesReverted));
  return json(404, { error: "unknown" });
});
vi.stubGlobal("fetch", fetchMock);

const names = new Map([
  [NODE_A, "محمد السالم"],
  [NODE_B, "محمد السالم"],
]);

let saved = 0;
const onSaved = async (): Promise<void> => {
  saved += 1;
};

function render(caseId: string | null): void {
  act(() => {
    root = createRoot(container);
    root.render(
      React.createElement(MergeReview, {
        caseId,
        nodeNames: names,
        onClose: () => undefined,
        onSaved,
      }),
    );
  });
}

beforeEach(() => {
  calls.length = 0;
  saved = 0;
  suggestionsBody = SUGGESTIONS_BODY;
  mergesReverted = false;
  acceptStatus = 201;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe("MergeReview (P4-005, UC-11)", () => {
  it("renders nothing without an opened case (the panel IS the explicit request)", () => {
    render(null);
    expect(container.innerHTML).toBe("");
  });

  it("fetches suggestions and the merge log on open — through the real API paths", async () => {
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls.some((c) => c.url.includes(`/cases/${CASE_ID}/merge-suggestions`))).toBe(true);
    expect(calls.some((c) => c.url.endsWith(`/cases/${CASE_ID}/merges`) && c.method === "GET")).toBe(true);
    expect(container.querySelector('[data-testid="merge-suggestion"]')).not.toBeNull();
  });

  it("shows the score as «درجة مطابقة» and the reasons — never a confidence", async () => {
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const text = container.textContent ?? "";
    expect(text).toContain("درجة مطابقة");
    expect(text).toContain("7.28");
    expect(text).toContain("الأسباب");
    expect(text).not.toContain("ثقة");
  });

  it("accepting a suggestion posts the pair + survivor + the echoed stamps, then refreshes the case", async () => {
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="merge-accept"]')];
    expect(buttons.length).toBe(2); // the survivor choice: one button per entity
    await act(async () => {
      buttons[0].click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const accept = calls.find((c) => c.method === "POST" && c.url.endsWith(`/cases/${CASE_ID}/merges`));
    if (!accept) throw new Error("the accept POST never happened");
    expect(accept.body).toMatchObject({
      entityIds: [NODE_A, NODE_B],
      survivorId: NODE_A,
      modelVersion: "er-model/1",
      caseVersion: 5,
    });
    expect(saved).toBe(1); // the write ends with a refreshed projection
  });

  it("the merge log's revert button posts the merge's own id and refreshes", async () => {
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const revert = container.querySelector<HTMLButtonElement>('[data-testid="merge-revert"]');
    if (!revert) throw new Error("the revert button never rendered");
    await act(async () => {
      revert.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const revertCall = calls.find((c) => c.url.includes(`/merges/${MERGE_ID}/revert`));
    expect(revertCall).toBeDefined();
    expect(saved).toBe(1);
  });

  it("a reverted merge shows the honest badge — no revert button", async () => {
    mergesReverted = true;
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="merge-reverted-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="merge-revert"]')).toBeNull();
  });

  it("the empty state is honest — no suggestions means no fake list", async () => {
    suggestionsBody = { modelVersion: "er-model/1", caseVersion: 5, suggestions: [] };
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="merge-review-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="merge-suggestion"]')).toBeNull();
  });

  it("a stale/failed accept shows an honest error and re-fetches — never a silent overwrite", async () => {
    acceptStatus = 409;
    render(CASE_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="merge-accept"]')];
    await act(async () => {
      buttons[0].click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="merge-review-error"]')).not.toBeNull();
    // re-fetched after the failure: the suggestions were requested again
    const suggestionCalls = calls.filter((c) => c.url.includes("/merge-suggestions"));
    expect(suggestionCalls.length).toBeGreaterThanOrEqual(2);
  });
});
