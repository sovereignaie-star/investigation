import { t } from "@ir/i18n";

/**
 * P6-015: the legal page — privacy policy, terms of use and the abuse-report
 * channel, published in Arabic and English (acceptance: منشورة بالعربية
 * والإنجليزية). The authoritative texts live in docs/legal/*.md; this page
 * renders their essence with a link to the full documents in the repository,
 * and follows the active locale (ar = RTL source of truth, en mirrors it).
 */
export function LegalPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6" dir="auto">
      <section aria-labelledby="legal-privacy">
        <h2 id="legal-privacy" className="mb-2 text-xl font-semibold">
          {t("legal.privacy.title")}
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("legal.privacy.body")}</p>
      </section>
      <section aria-labelledby="legal-terms">
        <h2 id="legal-terms" className="mb-2 text-xl font-semibold">
          {t("legal.terms.title")}
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("legal.terms.body")}</p>
      </section>
      <section aria-labelledby="legal-abuse">
        <h2 id="legal-abuse" className="mb-2 text-xl font-semibold">
          {t("legal.abuse.title")}
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("legal.abuse.body")}</p>
        <a
          className="text-sm underline underline-offset-4"
          href="https://github.com/sovereignaie-star/investigation/security/advisories"
          target="_blank"
          rel="noreferrer"
        >
          {t("legal.abuse.link")}
        </a>
      </section>
      <p className="text-xs text-muted-foreground">{t("legal.reviewNote")}</p>
    </div>
  );
}

/** Re-exported for the lazy route in App.tsx (keeps the import shape uniform). */
export default LegalPage;
