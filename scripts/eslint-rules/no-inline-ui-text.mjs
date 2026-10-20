// P3-017 — the zero-inline-text rule: no Arabic or English UI text embedded
// directly in JSX. Every UI string must come from @ir/i18n (t()). Numbers,
// single letters, punctuation and symbols stay allowed; technical attribute
// values (dir, rel, data-*, href…) are not UI text.
//
// Detection: a JSX text node, a string/template literal in JSX children, or a
// string value of a text-carrying attribute (placeholder, title, aria-label,
// alt, label…) is a violation when it contains an Arabic letter or a Latin
// word of 2+ letters.

const TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "aria-placeholder",
  "aria-valuetext",
  "aria-description",
  "placeholder",
  "title",
  "alt",
  "label",
]);

/** Any Arabic letter, or an English word of two or more letters. */
function hasUiWord(text) {
  return /[\u0600-\u06FF]/.test(text) || /[A-Za-z]{2,}/.test(text);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "P3-017: no inline UI text in JSX — every string comes from @ir/i18n (t()).",
    },
    schema: [],
    messages: {
      inlineText: "نص واجهة مضمن: «{{text}}» — ممنوع (P3-017)؛ استخدم t() من @ir/i18n. Inline UI text is banned; use t() from @ir/i18n.",
    },
  },
  create(context) {
    const report = (node, text) => {
      if (typeof text === "string" && hasUiWord(text)) {
        context.report({
          node,
          messageId: "inlineText",
          data: { text: text.trim().slice(0, 40) },
        });
      }
    };

    return {
      // <p>نص</p>
      JSXText(node) {
        report(node, node.value);
      },
      // <p>{'نص'}</p> and <p>{`نص`}</p> — but NOT attribute containers: attr={expr}.
      JSXExpressionContainer(node) {
        if (node.parent && node.parent.type === "JSXAttribute") return;
        const expression = node.expression;
        if (expression.type === "Literal") report(node, expression.value);
        else if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
          report(node, expression.quasis.map((q) => q.value.cooked).join(""));
        }
      },
      // <input placeholder="أدخل" /> / title= / aria-label= / alt= / label=
      JSXAttribute(node) {
        if (!TEXT_ATTRIBUTES.has(node.name.name)) return;
        if (node.value && node.value.type === "Literal") report(node, node.value.value);
      },
    };
  },
};
