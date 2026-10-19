#!/usr/bin/env python3
# P3-003b STATUS update
p = 'docs/STATUS.md'
s = open(p).read()

# compact row (the one that ended with the CodeQL fix text)
old = "طلب (أ) العقود والخلفية منفذ على الفرع — أحمر-أولاً قبلياً موثق (استيراد فاشل على main)؛ 11/11 عقد + 2022 حزمة كاملة خضراء. أصلح CodeQL: بوابة ULID + findCaseDir يطابق المعرّف ضد readdir — المسار لا يأتي من مدخل المستخدم إطلاقاً؛ + اختبار رفض). المتبقي: طلب (ب) CasesPage.** |"
assert old in s, "compact row not found"
new = "طلب (أ) مدمج (#239، 2f38150)؛ **طلب (ب) CasesPage منفذ على هذا الفرع (feat/P3-003b-cases-page):** متصلة بالخطافات المولدة، نموذج إنشاء بغرض (E-01)، مقفلة=معرف فقط (J-17)، مؤرشفة مخفية افتراضياً + إعادة فتح بتأكيد غرض (E-02)، رمز الأدمن في الذاكرة فقط (P1-021). أحمر-أولاً قبلياً موثق (استيراد فاشل على main)؛ 7/7 + 2029 حزمة كاملة خضراء. المتبقي: الدمج والتحقق اللاحق.** |"
s = s.replace(old, new)
open(p, 'w').write(s)
print('status b updated')
