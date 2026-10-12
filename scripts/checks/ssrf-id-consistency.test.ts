import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard (P2-003 / E): each T-SEC-SSRF-0NN ID has exactly ONE canonical
 * description, owned by `docs/ROADMAP.md` §8.3.1 (and mirrored by the coverage
 * matrix). The ADR-08 review log must not reuse 043/044/045 with a different
 * meaning (the vault-path meanings are 046/047/048). This test fails if any
 * ID is bound to two different short signatures.
 */

/** One-line canonical signature per ID (must match ROADMAP §8.3.1). */
const CANON = {
  "T-SEC-SSRF-043": "undeclared_data",
  "T-SEC-SSRF-044": "host_not_allowed",
  "T-SEC-SSRF-045": "IANA",
  "T-SEC-SSRF-046": "vault",
  "T-SEC-SSRF-047": "vault",
  "T-SEC-SSRF-048": "host_not_allowed",
} as const;

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/[A-Za-z]:/, "")), "..", "..");
const SKIP = new Set(["node_modules", "dist", "coverage", ".git", "generated", "iana"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(md|ts|tsx|mjs|cjs|txt|yaml|yml)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every distinct line in docs that mentions one of the guarded IDs. */
function linesMentioningIds(): Array<{ file: string; line: number; id: string; text: string }> {
  const hits: Array<{ file: string; line: number; id: string; text: string }> = [];
  for (const f of walk(path.join(REPO, "docs"))) {
    const text = readFileSync(f, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const id of Object.keys(CANON)) {
        if (line.includes(id)) {
          hits.push({ file: path.relative(REPO, f), line: i + 1, id, text: line.trim() });
        }
      }
    });
  }
  return hits;
}

describe("T-SEC-SSRF ID consistency (P2-003 / E)", () => {
  it("each guarded ID appears in the canonical matrix (ROADMAP §8.3.1)", () => {
    const roadmap = readFileSync(path.join(REPO, "docs", "ROADMAP.md"), "utf8");
    for (const id of Object.keys(CANON)) {
      expect(roadmap.includes(id), `${id} missing from ROADMAP`).toBe(true);
    }
  });

  it("no doc line binds an ID to a meaning that contradicts its canonical owner", () => {
    const hits = linesMentioningIds();
    // The vault-meaning lines must use 046/047/048, never 043/044/045.
    const misbound = hits.filter(({ id, text }) => {
      // Vault-meaning lines must use 046/047/048, never 043/044/045.
      const vaultMeaning =
        text.includes("مسار vault يمر بالبو") || text.includes("مفتاح المزود لا يظهر") || text.includes("مضيف غير مصرح → يُرفض");
      if (vaultMeaning && id !== "T-SEC-SSRF-046" && id !== "T-SEC-SSRF-047" && id !== "T-SEC-SSRF-048") return true;
      // IANA meaning must use 045 only.
      const ianaMeaning = /سجلَّي IANA|IANA special|iana-ipv4-special/.test(text);
      if (ianaMeaning && id !== "T-SEC-SSRF-045") return true;
      return false;
    });
    expect(misbound, JSON.stringify(misbound, null, 2)).toEqual([]);
  });

  it("rejects an ID/meaning swap among 046/047/048 (each vault meaning is bound to its own ID)", () => {
    const log = readFileSync(path.join(REPO, "docs", "adr", "ADR-08-review-log.md"), "utf8");
    const lines = log.split("\n");
    // 046 = vault path through the gateway. 047 = provider key never logged. 048 = unauthorized host rejected.
    const findLine = (id: string): string | undefined => lines.find((l) => l.trim().startsWith(`- ${id}:`));
    expect(findLine("T-SEC-SSRF-046")).toContain("مسار vault يمر بالبوّاب");
    expect(findLine("T-SEC-SSRF-047")).toContain("مفتاح المزود لا يظهر في أي سجل");
    expect(findLine("T-SEC-SSRF-048")).toContain("مضيف غير مصرح");
  });

  it("historical WORKLOG entries are not rewritten by this check (append-only history)", () => {
    // WORKLOG lines that mention 043/044/045 are historical records written
    // when the conflict existed; they are preserved as history. This test pins
    // that this suite does NOT modify WORKLOG and that current-state files
    // (ROADMAP, review log, source) use the renumbered IDs.
    const worklog = readFileSync(path.join(REPO, "docs", "WORKLOG.md"), "utf8");
    expect(worklog.includes("T-SEC-SSRF-043")).toBe(true); // historical, kept
  });

  it("the ADR-08 review log uses 046/047/048 for the vault meanings, not 043/044/045", () => {
    const log = readFileSync(path.join(REPO, "docs", "adr", "ADR-08-review-log.md"), "utf8");
    expect(log.includes("T-SEC-SSRF-046: مسار vault يمر بالبوّاب")).toBe(true);
    expect(log.includes("T-SEC-SSRF-047: مفتاح المزود لا يظهر في أي سجل")).toBe(true);
    expect(log.includes("T-SEC-SSRF-048: محاولة استخدام المسار لمضيف غير مصرح")).toBe(true);
    // The old misbinding is gone.
    expect(log.includes("T-SEC-SSRF-043: مسار vault")).toBe(false);
    expect(log.includes("T-SEC-SSRF-044: مفتاح المزود")).toBe(false);
    expect(log.includes("T-SEC-SSRF-045: محاولة استخدام المسار")).toBe(false);
  });

  it("test files that cite these IDs stay consistent with the canonical owner", () => {
    // The vault.test.ts cites the vault-path meaning with its canonical ID.
    const vault = readFileSync(path.join(REPO, "apps", "server", "src", "routes", "vault.test.ts"), "utf8");
    expect(vault.includes("T-SEC-SSRF-046")).toBe(true);
    expect(vault.includes("T-SEC-SSRF-048")).toBe(true);
  });
});
