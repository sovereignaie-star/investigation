// P3-017: the @ir/i18n public API — t(), the locale store, dir(), useI18n().
// Arabic is the source of truth (ar.ts); en.ts must satisfy the same keys.
import { useSyncExternalStore } from "react";
import { ar } from "./ar";
import { en } from "./en";
import { getLocale, setLocale, subscribe, type Locale } from "./store";

export type { Locale };
export type MessageKey = keyof typeof ar;

const DICTS: Record<Locale, Record<string, string>> = { ar, en };

/**
 * Looks up a message in the current locale, interpolating {param} placeholders.
 * An unknown key returns the key itself — visible, never silent (and never a
 * crash): a missing translation shows up as the key on screen.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const raw = DICTS[getLocale()][key] ?? ar[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, p: string) => String(params[p] ?? `{${p}}`));
}

/** The document direction implied by the current locale (ar -> rtl, en -> ltr). */
export function dir(): "rtl" | "ltr" {
  return getLocale() === "ar" ? "rtl" : "ltr";
}

/**
 * The React binding: subscribes the component to the locale store so a switch
 * re-renders it. Returns the stable { locale, dir, t, setLocale }.
 */
export function useI18n(): { locale: Locale; dir: () => "rtl" | "ltr"; t: typeof t; setLocale: typeof setLocale } {
  // getServerSnapshot: static/SSR renders see the current locale without subscribing.
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, dir, t, setLocale };
}

export { getLocale, setLocale };
