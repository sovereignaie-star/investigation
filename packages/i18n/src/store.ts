// P3-017: the module-level locale store. A tiny external store (no context
// provider needed) so plain view-model modules can call t() too — React
// components subscribe via useSyncExternalStore (useI18n).
export type Locale = "ar" | "en";

type Listener = () => void;

const listeners = new Set<Listener>();
let current: Locale = "ar";

/** The current locale (default: Arabic — the workbench is Arabic-first). */
export function getLocale(): Locale {
  return current;
}

/** Switches the locale and notifies every subscriber (useI18n re-renders). */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

/** The external-store subscribe contract of useSyncExternalStore. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
