[31m     [31m×[31m renders every event with its subject, predicate and object — sorted display order[39m[32m 5[2mms[22m[39m
[31m     [31m×[31m shows BOTH dimensions: the occurrence window label AND each observation's observedAt with its kind[39m[32m 4[2mms[22m[39m
[31m     [31m×[31m an event with no observations says so honestly instead of faking a time[39m[32m 1[2mms[22m[39m
     [32m✓[39m the row is the selection affordance: its subject node id is on the row (click wiring is proven in e2e)[32m 0[2mms[22m[39m
[31m     [31m×[31m the full raw occurrence window is exposed verbatim (title) — no precision or offset loss[39m[32m 3[2mms[22m[39m
[31m     [31m×[31m ISO timestamps are directionally isolated (dir=ltr) inside the RTL context — the BiDi visual scrambling fix[39m[32m 1[2mms[22m[39m
[31m     [31m×[31m buildTimelineItems feeds real graph shapes into the view (integration of model + view)[39m[32m 1[2mms[22m[39m
[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 6 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[31m[1mAssertionError[22m: expected 621 to be greater than 980[39m
[31m[1mAssertionError[22m: expected '<section aria-label="الخط الزمني" dat…' to contain '<span>من </span>'[39m
[31m[1mAssertionError[22m: expected '<section aria-label="الخط الزمني" dat…' to contain 'لا رصد'[39m
[31m[1mAssertionError[22m: expected '<section aria-label="الخط الزمني" dat…' to contain 'title="2019-01-01T00:00:00Z ← 2019-12…'[39m
[31m[1mAssertionError[22m: expected '<section aria-label="الخط الزمني" dat…' to match /<span dir="ltr" class="whitespac…/span>[39m
[31m[1mAssertionError[22m: expected '<section aria-label="الخط الزمني" dat…' to contain 'غير محدد'[39m
[2m      Tests [22m [1m[31m6 failed[39m[22m[2m | [22m[1m[32m1 passed[39m[22m[90m (7)[39m

---

**تذييل التوثيق:** هذا المستند هو الأصل الحرفي لدليل الأحمر السلوكي (توجيه المالك، البند 2) — الأوامر، الحقنة المؤقتة (فرز معكوس + حجب النتائج والملصقات والتنبيهات)، ونتيجة 6/7 فشل تأكيد سلوكي مقابل ناجح واحد. الاستعادة أثبتها السجل: 111/111 أخضر بعد إرجاع الكود. يُشار إليه من WORKLOG (الجولة الرابعة) وDECLARED_LIMITS (L-52).
