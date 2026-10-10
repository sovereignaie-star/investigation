import { expandExample, IDENTIFIER_SPECS } from "@ir/core/identifiers";
import type { IdentifierType } from "../types";

/**
 * Legacy view of the identifier catalog for existing components (P1-003). The data now lives in
 * packages/core/identifiers/*.yaml; this file only adapts it, so it can no longer grow into a 4,000-line literal (D-001).
 * Detection by "first match" in resultFetcher/smartInvestigator is replaced by the multi-candidate engine in P1-006.
 */
const CATEGORY_AR: Record<string, string> = {
  Email: "البريد الإلكتروني",
  Messaging: "المراسلة",
  Phone: "أرقام الهاتف",
  Network: "الشبكة",
  Domain: "النطاقات",
  Social: "التواصل الاجتماعي",
  Crypto: "العملات المشفرة",
  Documents: "وثائق الهوية",
  Device: "معرفات الأجهزة",
  Finance: "المالية",
  Hash: "الهاشات",
  API: "مفاتيح API",
  DarkWeb: "الويب المظلم",
};

export const IDENTIFIER_LIST: IdentifierType[] = IDENTIFIER_SPECS.map((s) => ({
  id: s.id,
  name: s.labels.en,
  nameAr: s.labels.ar,
  category: s.category,
  categoryAr: CATEGORY_AR[s.category] ?? s.category,
  icon: s.icon ?? "",
  color: s.color ?? "gray",
  description: s.description,
  regex: new RegExp(s.patterns.map((p) => `(?:${p})`).join("|"), s.flags ?? ""),
  examples: s.examples.positive.map(expandExample),
  ...(s.transforms?.length ? { apiSupport: s.transforms } : {}),
}));
