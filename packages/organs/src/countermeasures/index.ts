import { ETHICS_BASELINE, FORBIDDEN_BASELINE, type Organ } from "../types";

/** جهاز المكافحة — lawful, defensive response built on what the investigation found. */
export const countermeasures: Organ = {
  id: "countermeasures",
  nameAr: "جهاز المكافحة",
  nameEn: "Countermeasures Organ",
  mission:
    "تحويل نتائج التحري الموثَّقة إلى استجابة مشروعة ودفاعية: بلاغات للجهات المختصة ومزوّدي الاستضافة والنطاقات، وتصدير مؤشرات التهديد للدفاع، وحزم إحالة قابلة للتحقق.",
  responsibilities: [
    "إعداد حزم إحالة موثَّقة بالأدلة للجهات المختصة (قابلة للتحقق من سجل الأدلة)",
    "صياغة بلاغات إساءة لمزوّدي الاستضافة والنطاقات بمراجعة بشرية قبل أي إرسال",
    "تصدير مؤشرات التهديد بصيغ MISP وOpenIOC وقوائم IOC للدفاع",
    "توثيق كل إجراء استجابة في سجل التدقيق غير القابل للتعديل",
  ],
  linkedPackages: ["@ir/core", "@ir/ledger", "@ir/egress", "@ir/schema"],
  plannedTasks: ["P4-022"],
  ethics: [...ETHICS_BASELINE, "E-07"],
  offensive: false,
  forbidden: FORBIDDEN_BASELINE,
  maturity: "charter",
};
