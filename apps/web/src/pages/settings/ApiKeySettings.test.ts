import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiKeySettingsView } from "./ApiKeySettings";
import type { ApiKeySettingsState, KeyRowView } from "./apiKeySettingsModel";

/**
 * P3-013: ApiKeySettings presentational states, checked headlessly via static
 * markup (the app's established web test pattern — JSX spelled as
 * React.createElement so the file stays a .ts test like its siblings).
 *
 * UC-20's acceptance: «لا يظهر المفتاح في أي سجل أو رابط» — the secret is
 * type=password, its value is never pre-filled from the vault (the server never
 * returns it), and no URL carries it. Loading/error render honest states with
 * no invented statuses.
 */

const ROWS: KeyRowView[] = [
  {
    key: "resend",
    label: "مفتاح Resend",
    link: "https://resend.com/api-keys",
    description: "Sending email from the investigation inbox (notices).",
    placeholder: "re_xxx",
    configured: false,
    updatedAt: null,
  },
  {
    key: "anthropic",
    label: "مفتاح Anthropic",
    link: "https://console.anthropic.com/settings/keys",
    description: "The LLM that drives the narrative engine.",
    placeholder: "sk-ant-xxx",
    configured: true,
    updatedAt: "2026-10-19T10:00:00.000Z",
  },
];

const render = (state: ApiKeySettingsState): string => renderToStaticMarkup(React.createElement(ApiKeySettingsView, { state }));

describe("ApiKeySettingsView (P3-013)", () => {
  it("renders the idle prompt before the token is entered — no invented statuses", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain('data-testid="keys-idle"');
    expect(html).not.toContain('data-testid="key-row-resend"');
  });

  it("renders each provider row with its status, actions and a password-typed secret input", () => {
    const html = render({ kind: "ready", rows: ROWS, migration: null });
    expect(html).toContain('data-testid="keys-panel"');
    for (const k of ["resend", "anthropic"]) {
      expect(html).toContain(`data-testid="key-row-${k}"`);
      expect(html).toContain(`data-testid="key-save-${k}"`);
      expect(html).toContain(`data-testid="key-delete-${k}"`);
      expect(html).toContain(`data-testid="key-test-${k}"`);
      expect(html).toContain(`data-testid="key-secret-${k}"`);
    }
    // The configured provider shows its vault update time; the empty one does not.
    expect(html).toContain('data-testid="key-updated-anthropic"');
    // The secret input is password-typed — the key is never displayed.
    expect(html).toContain('type="password"');
  });

  it("never pre-fills the secret input — the stored key is never echoed", () => {
    const html = render({ kind: "ready", rows: ROWS, migration: null });
    expect(html).not.toContain('value="sk-');
    expect(html).not.toContain("re:");
  });

  it("renders the honest loading state with no provider statuses", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain('data-testid="keys-loading"');
    expect(html).not.toContain('data-testid="key-row-resend"');
  });

  it("renders the error state without inventing statuses", () => {
    const html = render({ kind: "error", message: "رمز الإدارة غير صحيح" });
    expect(html).toContain('data-testid="keys-error"');
    expect(html).toContain("رمز الإدارة غير صحيح");
    expect(html).not.toContain('data-testid="key-row-resend"');
  });

  it("surfaces the legacy localStorage migration report when it moved keys", () => {
    const html = render({ kind: "ready", rows: ROWS, migration: { moved: 1, conflicts: [], failed: [] } });
    expect(html).toContain('data-testid="keys-migration"');
    expect(html).toContain("1");
  });

  it("reports a migration conflict — never a silent replacement of a vault key", () => {
    const html = render({ kind: "ready", rows: ROWS, migration: { moved: 0, conflicts: ["shodan"], failed: [] } });
    expect(html).toContain('data-testid="keys-migration"');
    expect(html).toContain("shodan");
    expect(html).toContain("لم يُنقل شيء");
    expect(html).toContain("لم يُستبدل شيء");
  });

  it("surfaces a FAILED migration — a retry is promised, completion is never claimed", () => {
    const html = render({ kind: "ready", rows: ROWS, migration: null, migrationFailed: true });
    expect(html).toContain('data-testid="keys-migration-failed"');
    expect(html).toContain("فشل نقل");
  });
});
