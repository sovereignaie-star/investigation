import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell, Button } from "@ir/ui";
import { IDENTIFIER_LIST } from "./utils/identifierList";
// P3-003 (طلب ب): the cases screen, wired to the generated SDK over the case lifecycle API.
import { CasesPage } from "./pages/CasesPage";

// P0-006: minimal entry point so the app builds and runs. The real workbench is built in phase 3 (P3-002..P3-020).
// P3-002: the app renders inside the AppShell (layout, navigation, theme, RTL/LTR).
// Strings are inline for now; P3-017 moves every string to @ir/i18n (ar/en).

const REPO = "https://github.com/sovereignaie-star/investigation";

// Placeholder navigation: the overview is the only live screen; the workbench
// screens arrive with P3-003..P3-020 and stay disabled links until then.
const NAV = [
  { id: "overview", label: "نظرة عامة", href: "#/" },
  { id: "cases", label: "القضايا", href: "#/cases" },
  { id: "evidence", label: "سجل الأدلة", disabled: true },
  { id: "reports", label: "التقارير", disabled: true },
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
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell title="غرفة التحقيق" nav={NAV}>
        {/* P3-003: the workbench routes — the overview and the cases screen. */}
        {useHashPath() === "/cases" ? <CasesPage /> : <Overview />}
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
        <p className="text-sm text-muted-foreground">المرحلة 3 — محطة العمل</p>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          أداة تحقيق مفتوح المصدر، عربية الأولوية، محلية أولاً، تبني رسماً من الارتباطات فوق سجل أدلة موثَّق. محطة العمل قيد الإنشاء وفق
          خارطة الطريق.
        </p>
      </header>

      <section aria-labelledby="ids" className="mb-10">
        <h2 id="ids" className="mb-3 text-xl font-semibold">
          أنواع المعرّفات المعرّفة حالياً: <span dir="ltr">{IDENTIFIER_LIST.length}</span>
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
          وثائق المشروع الحاكمة
        </h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/ROADMAP.md`}>خارطة الطريق</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/STATUS.md`}>حالة المشروع</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/docs/WORKLOG.md`}>سجل العمل</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="link" className="h-auto p-0 font-normal underline">
              <a href={`${REPO}/blob/main/GOVERNANCE.md`}>القواعد الحاكمة</a>
            </Button>
          </li>
        </ul>
      </section>
    </div>
  );
}
