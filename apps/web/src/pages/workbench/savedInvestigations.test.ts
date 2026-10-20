import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { CaseSummary } from "@workspace/api-client-react";
import { getListCasesQueryKey } from "@workspace/api-client-react";

// P3-015: the SavedInvestigations surface — «فتح قضية بعد إعادة التشغيل». The
// workbench keeps no browser storage (D-033): the saved case is re-opened from
// the server through the same admin boundary (D-037, token in memory only),
// and the workbench then renders the case's own projection snapshot. A locked
// case (J-17) is listed as an identifier-only row with the locked message and
// NO open action — never silently filtered, never openable.
import { SavedInvestigationsView, OpenedCaseBanner } from "./SavedInvestigations";
import { toOpenedCase, type OpenedCase } from "./savedInvestigationsModel";
import { WorkbenchPage } from "../WorkbenchPage";

const ACTIVE: CaseSummary = {
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

const LOCKED: CaseSummary = {
  ...ACTIVE,
  id: "01M58XF9ZKJT50S8E8JYXF6P3YB",
  title: null,
  purpose: null,
  legalBasis: null,
  sensitivity: null,
  tags: null,
  encrypted: true,
  status: "locked-encrypted",
};

const SNAPSHOT = {
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
  counts: { entities: 1, nodes: 1, claims: 0, edges: 0, observations: 0, evidence: 0, merges: 0, notes: 0 },
  sha256: "a".repeat(64),
} as unknown as Record<string, unknown>;

const opened = (): OpenedCase =>
  toOpenedCase(ACTIVE, {
    seq: 4,
    sha256: "a".repeat(64),
    graph: { nodes: (SNAPSHOT.graph as { nodes: unknown[] }).nodes as never[], edges: [] },
  });

const renderView = (props: Partial<Parameters<typeof SavedInvestigationsView>[0]> = {}): string =>
  renderToStaticMarkup(
    React.createElement(SavedInvestigationsView, {
      cases: [ACTIVE, LOCKED],
      state: { kind: "idle" },
      token: "",
      onTokenChange: () => {},
      onOpen: () => {},
      activeCaseId: null,
      ...props,
    } as Parameters<typeof SavedInvestigationsView>[0]),
  );

function withQueryClient(element: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getListCasesQueryKey(), { cases: [ACTIVE, LOCKED] });
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, element));
}

describe("SavedInvestigationsView (P3-015 — فتح قضية بعد إعادة التشغيل)", () => {
  it("lists the saved cases with an open action for the active one — the workbench re-opens from the server", () => {
    const html = renderView();
    expect(html).toContain('data-testid="open-case-01M58XF9ZKJT50S8E8JYXF6P3X"');
    expect(html).toContain(ACTIVE.title as string);
  });

  it("a locked case (J-17) is listed as an identifier-only row with the locked message and NO open action", () => {
    const html = renderView();
    expect(html).toContain("مقفلة — تتطلب فك التشفير");
    expect(html).not.toContain('data-testid="open-case-01M58XF9ZKJT50S8E8JYXF6P3YB"');
  });

  it("keeps the admin token in memory only (D-033/D-037) — a token field is part of the surface", () => {
    const html = renderView();
    expect(html).toContain('data-testid="saved-token"');
  });

  it("disables the open action while opening and surfaces a failed open honestly — never an empty case dressed as opened", () => {
    const busy = renderView({ state: { kind: "opening", id: ACTIVE.id } });
    expect(busy).toContain('disabled=""');
    const failed = renderView({ state: { kind: "error", message: "HTTP 403" } });
    expect(failed).toContain('data-testid="saved-error"');
    expect(failed).toContain("HTTP 403");
  });

  it("marks the currently opened case (the workbench shows which case is loaded)", () => {
    const html = renderView({ activeCaseId: ACTIVE.id });
    expect(html).toContain('data-testid="opened-badge-01M58XF9ZKJT50S8E8JYXF6P3X"');
  });
});

describe("OpenedCaseBanner + WorkbenchPage integration (P3-015)", () => {
  it("the banner names the opened case: its title, its seq and the snapshot's sha256 — the identity is displayed, not guessed", () => {
    const html = renderToStaticMarkup(React.createElement(OpenedCaseBanner, { opened: opened(), onClose: () => {} }));
    expect(html).toContain(ACTIVE.title as string);
    expect(html).toContain("seq 4");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain('data-testid="opened-case-banner"');
  });

  it("the workbench renders the saved-investigations section from the generated hook's cache (fresh session, no retained state)", () => {
    const html = withQueryClient(React.createElement(WorkbenchPage));
    expect(html).toContain('data-testid="saved-investigations"');
    expect(html).toContain(ACTIVE.title as string);
  });

  it("an opened case drives the graph: its own projection nodes render in the workbench (the extracted-rows path is replaced until closed)", () => {
    const html = withQueryClient(React.createElement(WorkbenchPage, { initialOpenedCase: opened() }));
    expect(html).toContain('data-testid="opened-case-banner"');
    expect(html).toContain("domain:example.com");
  });
});
