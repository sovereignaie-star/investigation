import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CaseSummary } from "@workspace/api-client-react";
import { getListCasesQueryKey } from "@workspace/api-client-react";
// P3-003 (طلب ب): CasesPage wired to the generated SDK — the owner's decisions are the
// contract: create with a stated purpose (E-01), archived hidden by default (J-16),
// a locked case shows an identifier only (J-17), unarchive needs a PurposeConfirmation.
import { CasesPage } from "./pages/CasesPage";
import { CasesTable } from "./pages/cases/CasesTable";

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

const ARCHIVED: CaseSummary = {
  ...ACTIVE,
  id: "01M58XF9ZKJT50S8E8JYXF6P3YA",
  title: "قضية مؤرشفة",
  archivedAt: "2026-10-12T12:00:00.000Z",
  status: "archived",
};

const LOCKED: CaseSummary = {
  id: "01M58XF9ZKJT50S8E8JYXF6P3YB",
  title: null,
  purpose: null,
  legalBasis: null,
  createdAt: "2026-10-10T12:00:00.000Z",
  archivedAt: null,
  sensitivity: null,
  tags: null,
  encrypted: true,
  status: "locked-encrypted",
  lastActivityAt: "2026-10-11T12:00:00.000Z",
};

function withQueryClient(element: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-populate the cache the generated hook reads — no network in the render. The key
  // carries the P3-015 additions (includeArchived + the in-memory token: entering the
  // token refetches the list — the cold-browser flow of the cases screen).
  client.setQueryData([...getListCasesQueryKey(), false, ""], { cases: [ACTIVE, ARCHIVED, LOCKED] });
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, element));
}

describe("P3-003 CasesTable (J-16/J-17 rules)", () => {
  it("renders active cases with their title; a locked case shows the indicator row only — no title, no purpose", () => {
    const html = renderToStaticMarkup(React.createElement(CasesTable, { cases: [ACTIVE, LOCKED], includeArchived: false }));
    expect(html).toContain(ACTIVE.title);
    expect(html).toContain("مقفلة — تتطلب فك التشفير");
    expect(html).not.toContain("قضية مشفرة"); // a locked case has no title to leak
  });

  it("J-16: an archived case is hidden by default and listed when includeArchived=true", () => {
    const hidden = renderToStaticMarkup(React.createElement(CasesTable, { cases: [ACTIVE, ARCHIVED], includeArchived: false }));
    expect(hidden).not.toContain("قضية مؤرشفة");
    const shown = renderToStaticMarkup(React.createElement(CasesTable, { cases: [ACTIVE, ARCHIVED], includeArchived: true }));
    expect(shown).toContain("قضية مؤرشفة");
  });

  it("labels an archived case as archived and offers the reopen path (E-02)", () => {
    const shown = renderToStaticMarkup(React.createElement(CasesTable, { cases: [ARCHIVED], includeArchived: true, onReopen: () => {} }));
    expect(shown).toContain("مؤرشفة");
    expect(shown).toContain("إعادة فتح");
  });
});

describe("P3-003 CasesPage (wired to the generated SDK)", () => {
  it("renders the create form: title, purpose (E-01 minimum hint), legal basis and an optional passphrase", () => {
    const html = withQueryClient(React.createElement(CasesPage));
    expect(html).toContain("إنشاء قضية");
    expect(html).toContain("العنوان");
    expect(html).toContain("الغرض");
    expect(html).toContain("الأساس القانوني");
    expect(html).toContain("journalism");
    expect(html).toContain("عبارة المرور");
    expect(html).toContain("١٠"); // the E-01 minimum-length hint
  });

  it("lists the cases from the generated hook's cache (active visible, locked as identifier only)", () => {
    const html = withQueryClient(React.createElement(CasesPage));
    expect(html).toContain(ACTIVE.title);
    expect(html).toContain("مقفلة — تتطلب فك التشفير");
    expect(html).not.toContain("قضية مؤرشفة"); // J-16: hidden until the toggle is on
  });

  it("offers the includeArchived toggle (J-16) and the admin token field for the API boundary", () => {
    const html = withQueryClient(React.createElement(CasesPage));
    expect(html).toContain("إظهار المؤرشفة");
    expect(html).toContain("رمز الإدارة");
  });

  it("keeps the archive path on active cases (J-16) — archive action with a reason", () => {
    const html = withQueryClient(React.createElement(CasesPage));
    expect(html).toContain("أرشفة");
  });
});
