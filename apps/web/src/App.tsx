import { useMemo } from "react";
import { IDENTIFIER_LIST } from "./utils/identifierList";

// P0-006: minimal entry point so the app builds and runs. The real workbench is built in phase 3 (P3-002..P3-020).
// Strings are inline for now; P3-017 moves every string to @ir/i18n (ar/en).

const REPO = "https://github.com/sovereignaie-star/investigation";

export default function App() {
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
    <main className="mx-auto max-w-3xl px-6 py-12 text-start">
      <header className="mb-10">
        <p className="text-sm text-slate-500">المرحلة 0 — التثبيت والتأسيس</p>
        <h1 className="mt-2 text-3xl font-bold">غرفة التحقيق</h1>
        <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">
          أداة تحقيق مفتوح المصدر، عربية الأولوية، محلية أولاً، تبني رسماً من الارتباطات فوق سجل أدلة موثَّق.
          محطة العمل قيد الإنشاء وفق خارطة الطريق.
        </p>
      </header>

      <section aria-labelledby="ids" className="mb-10">
        <h2 id="ids" className="mb-3 text-xl font-semibold">
          أنواع المعرّفات المعرّفة حالياً: <span dir="ltr">{IDENTIFIER_LIST.length}</span>
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.map(([key, { ar, n }]) => (
            <li key={key} className="flex justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span>{ar}</span>
              <span dir="ltr" className="tabular-nums text-slate-500">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="docs">
        <h2 id="docs" className="mb-3 text-xl font-semibold">وثائق المشروع الحاكمة</h2>
        <ul className="list-disc space-y-1 ps-6">
          <li><a className="underline" href={`${REPO}/blob/main/docs/ROADMAP.md`}>خارطة الطريق</a></li>
          <li><a className="underline" href={`${REPO}/blob/main/docs/STATUS.md`}>حالة المشروع</a></li>
          <li><a className="underline" href={`${REPO}/blob/main/docs/WORKLOG.md`}>سجل العمل</a></li>
          <li><a className="underline" href={`${REPO}/blob/main/GOVERNANCE.md`}>القواعد الحاكمة</a></li>
        </ul>
      </section>
    </main>
  );
}
