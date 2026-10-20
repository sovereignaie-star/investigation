/**
 * P3-013: the pure model behind ApiKeySettings (UC-20 — provider keys managed
 * behind the admin boundary; the key never appears in any log or link).
 *
 * The vault is the source of truth for WHICH providers are configured (and
 * when); the app's provider definitions add the labels/links/descriptions. The
 * merge below keeps definition order and appends any vault provider the app
 * does not define yet (the vault may know more — an honest superset, never a
 * silent drop).
 */
import { API_KEY_DEFINITIONS, type KeyStatus, type KeySaveResponse } from "../../utils/apiKeyManager";

export type ApiKeyDefinition = (typeof API_KEY_DEFINITIONS)[number];

export type KeyRowView = {
  key: string;
  label: string;
  link: string;
  description: string;
  placeholder: string;
  configured: boolean;
  updatedAt: string | null;
};

/** A per-row action result — the honest Arabic message shown under the row. */
export type KeyActionResult = { success: boolean; message: string };

/** What the one-time legacy migration did: moved keys and non-replaced conflicts. */
export type MigrationReport = {
  moved: number;
  conflicts: string[];
  /** providers whose vault PUT failed — a partial outcome is reported, never hidden */
  failed: string[];
};

/**
 * A migration is COMPLETE only when it left nothing retryable: no conflict and no failed
 * move. Anything else stays retryable on the next read (the one-time flag must not be
 * set for an outcome the user still sees as unresolved).
 */
export function migrationComplete(report: MigrationReport): boolean {
  return report.conflicts.length === 0 && report.failed.length === 0;
}

/** The vault reads the read cycle needs (injected — the component passes apiKeyManager). */
export type KeyVaultReader = {
  status: () => Promise<Array<{ name: string; configured: boolean; updatedAt: string | null }>>;
  migrateLegacyKeys: () => Promise<MigrationReport>;
};

/** The outcome of one read cycle — what the component renders and remembers. */
export type ReadCycleOutcome = {
  /** the migration report (null when it was skipped: already complete this session) */
  report: MigrationReport | null;
  /** the migration threw (a corrupt legacy copy) — surfaced, retried on the next read */
  failed: boolean;
  /** whether the one-time flag may be set (complete = conflict-free AND failure-free) */
  complete: boolean;
  /** the vault statuses, or null when the status read itself failed */
  statuses: Array<{ name: string; configured: boolean; updatedAt: string | null }> | null;
  /** the status error message when statuses is null */
  error?: string;
};

/**
 * The REAL read flow the component runs: the migration runs first (only while the
 * one-time flag is unset), its outcome decides the flag (see migrationComplete), then
 * the vault statuses are read. A failed migration is surfaced but never blocks the
 * status read; a failed status read is surfaced but never erases the migration report.
 * A conflict or a partial failure keeps the flag UNSET — the next read re-CHECKS the
 * migration (it does NOT promise to re-move a failed key: the moved key may then show
 * up as a conflict, which is exactly what the next report says).
 */
export async function runReadCycle(reader: KeyVaultReader, alreadyComplete: boolean): Promise<ReadCycleOutcome> {
  let report: MigrationReport | null = null;
  let failed = false;
  let complete = alreadyComplete;
  if (!alreadyComplete) {
    try {
      report = await reader.migrateLegacyKeys();
      complete = migrationComplete(report);
    } catch {
      failed = true; // corrupt legacy copy — preserved, surfaced, retried on the next read
    }
  }
  let statuses: ReadCycleOutcome["statuses"] = null;
  let error: string | undefined;
  try {
    statuses = await reader.status();
  } catch (x) {
    error = (x as Error).message;
  }
  return { report, failed, complete, statuses, error };
}

export type ApiKeySettingsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      rows: KeyRowView[];
      /** What the one-time legacy localStorage migration did (null = nothing to do). */
      migration: MigrationReport | null;
      /** True when the migration attempt FAILED — completion is never claimed; the next read retries. */
      migrationFailed?: boolean;
      /** Per-provider action results (save/delete/test) — the key itself never appears. */
      messages?: Record<string, KeyActionResult>;
      /** Per-provider busy flag — one action at a time per row. */
      busy?: Record<string, boolean>;
    };

/** Merges the app's provider definitions with the vault's statuses. */
export function buildKeyRows(definitions: ApiKeyDefinition[], statuses: KeyStatus[]): KeyRowView[] {
  const rows: KeyRowView[] = definitions.map((d) => {
    const s = statuses.find((x) => x.name === d.key);
    return {
      key: d.key,
      label: d.labelAr,
      link: d.link,
      description: d.description,
      placeholder: d.placeholder,
      configured: s?.configured ?? false,
      updatedAt: s?.updatedAt ?? null,
    };
  });
  for (const s of statuses) {
    if (definitions.some((d) => d.key === s.name)) continue;
    rows.push({
      key: s.name,
      label: s.name,
      link: "",
      description: "",
      placeholder: "",
      configured: s.configured,
      updatedAt: s.updatedAt,
    });
  }
  return rows;
}

/**
 * The one-time legacy localStorage migration report — null when there was nothing
 * to do. A conflict (the vault already has a key for that provider) is reported,
 * never silently replaced: replacement stays an explicit manual save.
 */
export function migrationNotice(report: MigrationReport): string | null {
  const parts: string[] = [];
  if (report.failed.length > 0) {
    // a partial/failed move keeps the local copy — the wording must say so. The next read
    // RE-CHECKS (it does not promise to re-move the failed key: the moved key may then
    // show up as a conflict — see runReadCycle).
    parts.push(
      `فشل نقل ${report.failed.length === 1 ? "مفتاح" : "مفاتيح"}: ${report.failed.join("، ")}${report.moved > 0 ? ` (نُقل ${report.moved} بنجاح)` : ""} — النسخة المحلية لم تُحذف؛ القراءة التالية تقوم بإعادة الفحص`,
    );
  } else if (report.moved > 0) {
    parts.push(
      `نُقل ${report.moved} ${report.moved === 1 ? "مفتاح" : "مفاتيح"} قديمة من ذاكرة المتصفح إلى الخزنة في الخادم وحُذفت النسخة المحلية`,
    );
  }
  if (report.conflicts.length > 0) {
    parts.push(
      `تعارض: الخزنة لديها مفاتيح بالفعل لـ ${report.conflicts.join("، ")} — لم يُنقل شيء ولم يُستبدل شيء، والنسخة المحلية بقيت كما هي`,
    );
  }
  return parts.length > 0 ? parts.join(" — ") : null;
}

/** A failed migration is stated honestly — a retry is promised, completion never claimed. */
export function migrationFailureNotice(): string {
  return "فشل نقل المفاتيح القديمة من ذاكرة المتصفح — ستعاد المحاولة عند القراءة التالية، والنسخة المحلية لم تُحذف";
}

/**
 * P2-015: the save response carries the key test result — a failed test does
 * NOT unsave the key, so the message reports BOTH facts. Where no test was
 * possible the message says so with the reason; success is never fabricated.
 */
export function formatSaveOutcome(save: KeySaveResponse): KeyActionResult {
  if (save.tested === true && save.ok === true) {
    const quota = save.quota;
    if (quota?.supported && quota.alert80 && quota.usedPct !== undefined) {
      const what = quota.action ? `${quota.action} (${quota.window ?? "نافذة"})` : "الحصة";
      return { success: true, message: `حُفظ المفتاح — الاختبار صحيح — تنبيه: استُهلك ${quota.usedPct}% من ${what}` };
    }
    return { success: true, message: "حُفظ المفتاح — الاختبار صحيح" };
  }
  if (save.tested === true && save.ok !== true) {
    return { success: false, message: "حُفظ المفتاح — فشل اختبار المزوّد (المفتاح محفوظ رغم ذلك)" };
  }
  return { success: true, message: `حُفظ المفتاح — لم يُختبر (${save.reason ?? "بلا ناقل اختبار"})` };
}
