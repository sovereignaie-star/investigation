import { ETHICS_BASELINE, FORBIDDEN_BASELINE, type Organ } from "../types";

/** جهاز الوقاية الجنائية — keeps evidence, cases and the investigator safe before anything goes wrong. */
export const prevention: Organ = {
  id: "prevention",
  nameAr: "جهاز الوقاية الجنائية",
  nameEn: "Forensic Prevention Organ",
  mission: "حماية الأدلة والقضايا والمحقق قبل وقوع الضرر: سلامة سجل الأدلة، وضبط الخروج إلى الشبكة، وفحص الملفات الواردة قبل التعامل معها.",
  responsibilities: [
    "التحقق من سلامة سجل الأدلة وكشف أي تعديل صامت عليه",
    "فرض سياسة الخروج إلى الشبكة وعزل المحوّلات ومنع الوصول إلى الشبكات الداخلية",
    "حماية بيانات القضايا بالتشفير المحلي وسياسة الاحتفاظ والحذف الآمن",
    "فحص الملفات المرفوعة بقواعد YARA وSigma محلية قبل فتحها",
  ],
  linkedPackages: ["@ir/ledger", "@ir/egress", "@ir/store", "@ir/transform-sandbox", "@ir/core"],
  plannedTasks: ["P4-021"],
  ethics: [...ETHICS_BASELINE, "E-09"],
  offensive: false,
  forbidden: FORBIDDEN_BASELINE,
  maturity: "charter",
};
