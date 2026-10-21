import { ETHICS_BASELINE, FORBIDDEN_BASELINE, type Organ } from "../types";

/** جهاز التحري — turns an identifier or document into a sourced, scored graph of links. */
export const investigation: Organ = {
  id: "investigation",
  nameAr: "جهاز التحري",
  nameEn: "Investigation Organ",
  mission:
    "بناء الرسم البياني للارتباطات من معرّف أو وثيقة فوق سجل أدلة موثَّق، بمصدر ووقت جلب ودرجة ثقة قابلة للتفسير، وإعادة تشغيل التحقيق على أدلته المؤرشفة.",
  responsibilities: [
    "استخراج المعرّفات من النصوص والملفات وتطبيعها",
    "تشغيل المحوّلات المسموحة عبر محرك القضية وتسجيل كل طلب خارجي",
    "ربط النتائج بنموذج الثقة وتفسير كل درجة",
    "ربط مؤشرات التهديد بأطر MITRE ATT&CK وCAPEC وD3FEND",
  ],
  linkedPackages: ["@ir/engine", "@ir/transforms", "@ir/core", "@ir/schema", "@ir/ledger"],
  plannedTasks: ["P4-001", "P4-020"],
  ethics: [...ETHICS_BASELINE, "E-07", "E-08"],
  offensive: false,
  forbidden: FORBIDDEN_BASELINE,
  maturity: "charter",
};
