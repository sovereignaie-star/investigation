import * as React from "react";

import { t, setLocale } from "@ir/i18n";

import { Button } from "./button";

// P3-002: the workbench app shell — layout, navigation, theme and direction.
// Strings are inline for now; P3-017 moves every string to @ir/i18n (ar/en).

export type Theme = "light" | "dark";
export type Direction = "rtl" | "ltr";

/** Cycles the shell theme (light <-> dark). Pure, unit-tested. */
export function nextTheme(current: Theme): Theme {
  return current === "light" ? "dark" : "light";
}

/** Applies a theme to a DOM-like element via the `.dark` class (see styles.css). */
export function applyTheme(el: HTMLElement, theme: Theme): void {
  el.classList.toggle("dark", theme === "dark");
}

/** Applies direction and language to a DOM-like element. */
export function applyDir(el: HTMLElement, dir: Direction): void {
  el.dir = dir;
  el.lang = dir === "rtl" ? "ar" : "en";
}

export type AppShellNavItem = {
  id: string;
  label: React.ReactNode;
  href?: string;
  active?: boolean;
  disabled?: boolean;
};

export type AppShellProps = {
  title: React.ReactNode;
  nav?: AppShellNavItem[];
  /** Default direction is RTL (Arabic-first workbench). */
  dir?: Direction;
  /** Initial theme; the header toggle switches it at runtime. */
  theme?: Theme;
  children?: React.ReactNode;
};

export function AppShell({ title, nav = [], dir = "rtl", theme = "light", children }: AppShellProps) {
  const [currentTheme, setCurrentTheme] = React.useState<Theme>(theme);
  const [currentDir, setCurrentDir] = React.useState<Direction>(dir);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    applyTheme(document.documentElement, currentTheme);
  }, [currentTheme]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    applyDir(document.documentElement, currentDir);
  }, [currentDir]);

  const toggleTheme = () => setCurrentTheme(nextTheme);
  // P3-017: the direction toggle is the language toggle — the locale is the
  // source of truth (ar -> rtl, en -> ltr) and every t() string follows it.
  const toggleDir = () => {
    setCurrentDir((d) => {
      const next = d === "rtl" ? "ltr" : "rtl";
      setLocale(next === "rtl" ? "ar" : "en");
      return next;
    });
  };

  return (
    <div dir={currentDir} className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="flex items-center gap-2">
          <Button
            data-theme-toggle
            variant="outline"
            size="sm"
            onClick={toggleTheme}
            aria-label={currentTheme === "light" ? t("shell.theme.toDark") : t("shell.theme.toLight")}
          >
            {currentTheme === "light" ? t("shell.theme.dark") : t("shell.theme.light")}
          </Button>
          <Button
            data-dir-toggle
            variant="outline"
            size="sm"
            onClick={toggleDir}
            aria-label={currentDir === "rtl" ? t("shell.lang.toEn") : t("shell.lang.toAr")}
          >
            {currentDir === "rtl" ? t("shell.lang.en") : t("shell.lang.ar")}
          </Button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-e bg-card md:block">
          <nav aria-label={t("nav.main")} className="p-2">
            <ul className="space-y-1">
              {nav.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.disabled ? undefined : (item.href ?? "#")}
                    aria-current={item.active ? "page" : undefined}
                    aria-disabled={item.disabled}
                    className={[
                      "block rounded-md px-3 py-2 text-sm",
                      item.active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      item.disabled ? "pointer-events-none opacity-50" : "",
                    ].join(" ")}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
