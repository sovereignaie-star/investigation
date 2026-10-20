// P3-017 red-first: the lint rule that enforces «صفر نص مضمن» — no Arabic or
// English UI text embedded directly in JSX. Every string must come from
// @ir/i18n (t()). This test drives the rule through ESLint's Linter against
// code samples: violating code fails, t()-based code passes.
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import noInlineUiText from "../eslint-rules/no-inline-ui-text.mjs";

const linter = new Linter({ configType: "flat" });

const verify = (code: string): number =>
  linter.verify(code, {
    plugins: { local: { rules: { "no-inline-ui-text": noInlineUiText } } },
    languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "local/no-inline-ui-text": "error" },
  }).length;

describe("no-inline-ui-text (P3-017 — the zero-inline-text rule)", () => {
  it("fails on Arabic text embedded in JSX", () => {
    expect(verify("const x = () => (<p>نص عربي</p>);")).toBe(1);
  });

  it("fails on English text embedded in JSX", () => {
    expect(verify("const x = () => (<p>English text</p>);")).toBe(1);
  });

  it("fails on string literals in JSX children expressions and templates", () => {
    expect(verify("const x = () => (<p>{'نص'}</p>);")).toBe(1);
    expect(verify("const x = () => (<p>{`نص`}</p>);")).toBe(1);
  });

  it("fails on text-carrying attributes (placeholder, title, aria-label, alt)", () => {
    expect(verify('const x = () => (<input placeholder="أدخل النص" />);')).toBe(1);
    expect(verify('const x = () => (<span title="save" />);')).toBe(1);
    expect(verify('const x = () => (<span aria-label="حفظ" />);')).toBe(1);
    expect(verify('const x = () => (<img alt="صورة" />);')).toBe(1);
  });

  it("passes t()-based strings, technical attributes, numbers and symbols", () => {
    expect(verify("const x = () => (<p>{t('common.loading')}</p>);")).toBe(0);
    // Technical attribute values are not UI text.
    expect(verify('const x = () => (<span dir="ltr" rel="noopener noreferrer" />);')).toBe(0);
    expect(verify('const x = () => (<span data-kind="file" />);')).toBe(0);
    // Numbers, single letters, punctuation and symbols are not words.
    expect(verify("const x = () => (<p>42</p>);")).toBe(0);
    expect(verify("const x = () => (<p>+1 (555)</p>);")).toBe(0);
    expect(verify("const x = () => (<p>•</p>);")).toBe(0);
    expect(verify("const x = () => (<p>a</p>);")).toBe(0);
  });

  it("ignores comments and non-JSX code", () => {
    expect(verify('// نص عربي في تعليق\nconst s = "نص";')).toBe(0);
  });
});
