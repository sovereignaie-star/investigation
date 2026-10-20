/**
 * P3-021 red-first: docs/shortcuts.md is the DOCUMENTED shortcuts surface the
 * acceptance names («اختصارات لوحة المفاتيح الموثقة»). This guard fails while the
 * file does not exist, and keeps failing if a registry shortcut ships without
 * documentation — an undocumented shortcut is a hidden feature, and a documented
 * shortcut that no longer exists is a lie in the manual.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "./registry";

const DOC = readFileSync(join(process.cwd(), "docs/shortcuts.md"), "utf-8");

describe("P3-021 docs/shortcuts.md — the documented shortcuts surface", () => {
  it("documents the palette, the context-menu key, and the delete action", () => {
    expect(DOC).toContain("Ctrl");
    expect(DOC).toContain("K");
    expect(DOC).toContain("Shift");
    expect(DOC).toContain("F10");
    expect(DOC).toContain("Delete");
  });

  it("every shortcut key a registry command declares appears in the manual", () => {
    for (const c of COMMANDS) {
      if (c.shortcut) {
        expect(DOC, `the manual must document the shortcut of ${c.id}`).toContain(c.shortcut);
      }
    }
  });
});
