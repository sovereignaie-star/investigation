import { PSL_EXCEPTIONS, PSL_RULES, PSL_WILDCARDS } from "./rules.ts";

/**
 * Public Suffix List lookups (https://publicsuffix.org/list/), ICANN and private sections, using the standard algorithm:
 * the longest matching rule wins, exception rules beat wildcards, and an unlisted TLD falls back to the implicit "*"
 * rule. Imported from "@ir/core/psl" so the 150 KB rule set is only bundled where it is needed.
 */
let sets: { rules: Set<string>; wild: Set<string>; exc: Set<string> } | null = null;
const load = () =>
  (sets ??= {
    rules: new Set(PSL_RULES.split("\n")),
    wild: new Set(PSL_WILDCARDS.split("\n")),
    exc: new Set(PSL_EXCEPTIONS.split("\n")),
  });

function toAsciiLabel(label: string): string | null {
  if (/^[\x21-\x7e]*$/.test(label)) return label;
  try {
    return new URL(`http://${label}`).hostname;
  } catch {
    return null;
  }
}

type Split = { labels: string[]; suffixLength: number };

function split(domain: string): Split | null {
  if (!domain || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  const labels = domain.toLowerCase().split(".");
  const ascii = labels.map(toAsciiLabel);
  if (ascii.some((l) => l === null || l === "")) return null;
  const a = ascii as string[];
  const { rules, wild, exc } = load();
  const n = a.length;
  let suffixLength = 1;
  for (let i = 0; i < n; i++) {
    const cand = a.slice(i).join(".");
    if (exc.has(cand)) {
      suffixLength = n - i - 1;
      break;
    }
    if (rules.has(cand) || (i + 1 < n && wild.has(a.slice(i + 1).join(".")))) {
      suffixLength = n - i;
      break;
    }
  }
  return { labels, suffixLength };
}

/** The public suffix of a host ("co.uk" for "a.b.co.uk"), or null for malformed input. */
export function publicSuffix(domain: string | null | undefined): string | null {
  const s = domain ? split(domain) : null;
  return s ? s.labels.slice(-s.suffixLength).join(".") : null;
}

/** The registrable domain (public suffix plus one label), or null when the host is itself a public suffix. */
export function registrableDomain(domain: string | null | undefined): string | null {
  const s = domain ? split(domain) : null;
  if (!s || s.labels.length <= s.suffixLength) return null;
  return s.labels.slice(-(s.suffixLength + 1)).join(".");
}

/** A syntactically valid DNS host (LDH labels, 1-63 chars each, at most 253 total) with a registrable domain. */
export function isRegistrableHost(host: string): boolean {
  const ascii = host.toLowerCase().split(".").map(toAsciiLabel);
  if (ascii.some((l) => l === null || !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(l))) return false;
  if (ascii.join(".").length > 253) return false;
  return registrableDomain(host) !== null;
}
