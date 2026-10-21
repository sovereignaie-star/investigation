import { lazy, Suspense, useEffect, useMemo, useState } from "react";
// P3-019: route-level code splitting — the heavy screens load on demand, the
// initial download stays within the 300KB gzipped budget.
const CasesPage = lazy(() => import("./pages/CasesPage").then((m) => ({ default: m.CasesPage })));
const EvidencePage = lazy(() => import("./pages/EvidencePage").then((m) => ({ default: m.EvidencePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const WorkbenchPage = lazy(() => import("./pages/WorkbenchPage").then((m) => ({ default: m.WorkbenchPage })));
const InfiniteCanvas = lazy(() => import("./pages/workbench/InfiniteCanvas").then((m) => ({ default: m.InfiniteCanvas })));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell, Button } from "@ir/ui";
// P3-017: every UI string comes from @ir/i18n — the app subscribes to the
// locale store so a language switch re-renders the whole tree.
import { t, useI18n } from "@ir/i18n";
import { IDENTIFIER_LIST } from "./utils/identifierList";
// P3-023: the error boundary and the skeleton loading state.
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { PageSkeleton } from "./components/PageSkeleton";
// P3-003 (طلب ب): the cases screen, wired to the generated SDK over the case lifecycle API.
// P3-004 (UC-02): the workbench input flow — paste text or read a file, extract identifiers.
// P3-010: the raw-evidence screen — sanitized HTML in a sandboxed iframe, text, or honest refusal.
// P3-013: the settings screen — the key-management surface (UC-20).
// P3-005: the large-graph canvas and its NFR-02 measurement harness.
import { GraphBenchPage } from "./pages/workbench/GraphBenchPage";
// P3-006: the small editable canvas (@xyflow/react).

// P0-006: minimal entry point so the app builds and runs. The real workbench is built in phase 3 (P3-002..P3-020).
// P3-002: the app renders inside the AppShell (layout, navigation, theme, RTL/LTR).
// Strings are inline for now; P3-017 moves every string to @ir/i18n (ar/en).

const REPO = "https://github.com/sovereignaie-star/investigation";

// Placeholder navigation: the overview is the only live screen; the workbench
// screens arrive with P3-003..P3-020 and stay disabled links until then.
const NAV = [
  { id: "overview", label: t("nav.overview"), href: "#/" },
  { id: "workbench", label: t("nav.workbench"), href: "#/workbench" },
  { id: "canvas", label: t("nav.canvas"), href: "#/canvas" },
  { id: "cases", label: t("nav.cases"), href: "#/cases" },
  { id: "evidence", label: t("nav.evidence"), href: "#/evidence" },
  { id: "settings", label: t("nav.settings"), href: "#/settings" },
  { id: "reports", label: t("nav.reports"), disabled: true },
];

/**
 * P3-003: a tiny hash router (SSR-safe — static renders see "/"). Hash routing needs no
 * server-side fallback for deep links and keeps the workbench deployable as plain files.
 */
function useHashPath(): string {
  const [path, setPath] = useState(() => (typeof window === "undefined" ? "/" : window.location.hash.replace(/^#/, "") || "/"));
  useEffect(() => {
    const onHash = (): void => setPath(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return path;
}

// P3-003: one query client for the workbench — the generated hooks read it.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export default function App() {
  const path = useHashPath();
  // P3-017: subscribing here re-renders the tree on a locale switch (the NAV
  // labels and every page's t() strings follow the new locale).
  useI18n();
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell title={t("app.title")} nav={NAV}>
        {/* P3-003..P3-005: workbench routes — overview, cases, input flow and graph bench.
            P3-019: the heavy screens are lazy — Suspense shows the honest loading
            state while the route's chunk downloads. */}
        <AppErrorBoundary path={path}>
          <Suspense fallback={<PageSkeleton />}>
            {path === "/cases" ? (
              <CasesPage />
            ) : path === "/evidence" ? (
              <EvidencePage />
            ) : path === "/settings" ? (
              <SettingsPage />
            ) : path === "/workbench" ? (
              <WorkbenchPage />
            ) : path === "/graph-bench" ? (
              <GraphBenchPage />
            ) : path === "/canvas" ? (
              <div className="h-[calc(100vh-4rem)]">
                <InfiniteCanvas />
              </div>
            ) : (
              <Overview />
            )}
          </Suspense>
        </AppErrorBoundary>
      </AppShell>
    </QueryClientProvider>
  );
}

/** The overview screen: the phase-3 placeholder the workbench grows out of. */
function Overview(): React.ReactElement {
  const categories = useMemo(() => {
    const counts = new Map<string, { ar: string; n: number }>();
    for (const t of IDENTIFIER_LIST) {
      const c = counts.get(t.category) ?? { ar: t.categoryAr, n: 0 };
      c.n += 1;
      counts.set(t.category, c);
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  }, []);
  return (
    <div>
      <header className="mb-10">
        <p className="text-sm text-muted-foreground">{t("overview.phase")}</p>
        <p className="mt-3 leading-relaxed text-muted-foreground">{t("overview.intro")}</p>
      </header>

      <section aria-labelledby="ids" className="mb-10">
        <h2 id="ids" className="mb-3 text-xl font-semibold">
          {t("overview.identifierTypes")} <span dir="ltr">{IDENTIFIER_LIST.length}</span>
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.map(([key, { ar, n }]) => (
            <li key={key} className="flex justify-between rounded-md border border-border px-3 py-2">
              <span>{ar}</span>
              <span dir="ltr" className="tabular-nums text-muted-foreground">
                {n}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="docs">
        <h2 id="docs" className="mb-3 text-xl font-semibold">
          {t("overview.governingDocs")}
        </h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/ROADMAP.md`}>{t("overview.roadmap")}</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/STATUS.md`}>{t("overview.status")}</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/WORKLOG.md`}>{t("overview.worklog")}</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/GOVERNANCE.md`}>{t("overview.governance")}</a>
            </Button>
          </li>
        </ul>
      </section>
    </div>
  );
}
