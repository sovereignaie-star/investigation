# P4-007 — دليل الأحمر السلوكي (إثبات تعطيل تعويضي منفَّذ بحكم المالك 18:55 +03)

الوصف الصادق أولاً: هذا **إثبات تعطيل تعويضي لاحق** لا أحمر تاريخي سابق للتنفيذ — كود مكوّن العرض كان قد كُتب قبل أي تشغيل أحمر سلوكي ناجح (الانحراف الموثق في L-52). الغرض: إثبات أن اختبارات العرض، عند تعطيل التنفيذ، تفشل على تأكيداتها السلوكية لا على أخطاء استيراد أو بناء.

مصدر المستند: مخرجات الأمر أدناه أُخذت حرفياً وقت التنفيذ (2026-10-21، محفوظة أصلاً في ملف مؤقت ثم أُلحقت هنا). الأوامر والحقنة المؤقتة منقولة حرفياً من سجل الجلسة، وقد أُعيد بناء صياغتها من السجل نفسه — كل ما دون مخرجات الأمر مبني على السجل المحفوظ لا على الذاكرة.

## الأمر (حرفي من سجل الجلسة)

```bash
cd /home/user/workspace/ir-p4-007 && python3 - << 'PYEOF'
# (حقن الحارسين المؤقتين — انظر القسم التالي)
PYEOF
source $HOME/.node24rc && pnpm vitest run apps/web/src/pages/workbench/TimelineView.test.ts 2>&1 | grep -E "×|✓|Tests |AssertionError|Cannot|SyntaxError" | head -20 | tee /tmp/p4007-red-behavioral.log
```

## الحقنة المؤقتة (حرفية من سجل الجلسة — لم تُلتزم قط)

```python
# 1. timelineModel.ts — sortTimelineItems returns the WRONG order (reversed).
s2 = s.replace(
    '  dated.sort(byKnownBounds);\n  undated.sort((a, b) => (a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0));\n  return [...dated, ...undated];',
    '  // STUB (behavioral-red proof): wrong order on purpose.\n  return [...items].reverse();',
)

# 2. TimelineView.tsx — withhold the occurrence label AND the observations.
label_block = re.search(
    r'        <span className="text-muted-foreground" title=\{label\.full\}>.*?\n        </span>\n',
    s, re.DOTALL,
)
s2 = s.replace(label_block.group(0), "        {/* STUB (behavioral-red proof): the occurrence label is withheld. */}\n")
obs_block = re.search(
    r"      \{item\.observations\.length === 0 \? \(.*?\n      \)\}\n",
    s2, re.DOTALL,
)
s3 = s2.replace(obs_block.group(0), "      {/* STUB (behavioral-red proof): observations are withheld. */}\n")
```

أي: `sortTimelineItems` أعادت ترتيباً معكوساً (صياغة سليمة — لا خلل استيراد)، وحُجبت تسمية نافذة الحدوث وملاحظات الرصد من العرض (حذف كتلتَي JSX مع إبقاء صياغة صحيحة).

## المخرجات الحرفية (كما التقطها الأمر)

```
     × renders every event with its subject, predicate and object — sorted display order 5ms
     × shows BOTH dimensions: the occurrence window label AND each observation's observedAt with its kind 4ms
     × an event with no observations says so honestly instead of faking a time 1ms
     ✓ the row is the selection affordance: its subject node id is on the row (click wiring is proven in e2e) 0ms
     × the full raw occurrence window is exposed verbatim (title) — no precision or offset loss 3ms
     × ISO timestamps are directionally isolated (dir=ltr) inside the RTL context — the BiDi visual scrambling fix 1ms
     × buildTimelineItems feeds real graph shapes into the view (integration of model + view) 1ms
⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯
AssertionError: expected 621 to be greater than 980
AssertionError: expected '<section aria-label="الخط الزمني" dat…' to contain '<span>من </span>'
AssertionError: expected '<section aria-label="الخط الزمني" dat…' to contain 'لا رصد'
AssertionError: expected '<section aria-label="الخط الزمني" dat…' to contain 'title="2019-01-01T00:00:00Z ← 2019-12…'
AssertionError: expected '<section aria-label="الخط الزمني" dat…' to match /<span dir="ltr" class="whitespac…/span>/
AssertionError: expected '<section aria-label="الخط الزمني" dat…' to contain 'غير محدد'
      Tests  6 failed | 1 passed (7)
```

## الاستعادة وإثباتها

```bash
cd /home/user/workspace/ir-p4-007 && git checkout -- apps/web/src/pages/workbench/timelineModel.ts apps/web/src/pages/workbench/TimelineView.tsx
```

بعد الاستعادة عادت حزمة workbench كلها خضراء: **111/111 ناجح** (موثق في إدخال حكم المالك بالسجل). الحقنة لم تدخل أي التزام — شجرة العمل كانت نظيفة قبلها وبعدها (أكد `git status` ذلك وقتها).

## الخلاصة

ستة من سبعة اختبارات فشلت جميعها بـ AssertionError سلوكية (الترتيب، البعدان، الصدق، الطابع الخام، عزل BiDi، التكامل) — والناجح الوحيد (اختيار الصف) نجح لأن الحقنة أبقت بنية الصف: الاختبارات تميّز السلوك عن البنية. عند تعطيل التنفيذ تفشل اختبارات العرض على تأكيداتها السلوكية — وهي مثبتة الفاعلية، لا مكتوبة افتراضاً. يُشار إلى هذا المستند من WORKLOG (الجولة الرابعة) وDECLARED_LIMITS (L-52).
