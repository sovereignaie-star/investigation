# جرد الأصول القديمة (legacy)

أصول رُفعت إلى المستودع قبل بدء التنفيذ. كانت 26 ملف بايثون = 13 ملفاً فريداً، كل ملف بنسختين متطابقتين بايتاً ببايت. أُبقيت نسخة واحدة باسم نظيف وحُذفت المكررة (P0-016، العيب D-042). التقييم في الخارطة 2.9، والاستخراج إلى YAML منظّم مقترح في المرحلة 5.

**لا تُستورد هذه الملفات في أي كود.** قيمتها معرفية (تصنيفات وأوصاف)، لا برمجية.

| الملف | الأسطر | البايتات | SHA-256 | `py_compile` | الحكم (الخارطة 2.9) | الأسماء الأصلية (نسختان متطابقتان) |
|---|---|---|---|---|---|---|
| `Investigation1.py` | 1,503 | 103,861 | `5cee26cadf006fe447829a41fced1998e9114b628ca5f9e5d644e6c24c857092` | يمر | بايثون صالح — تصنيفات CIKMS | `Investigation1_1781665423311.py`، `Investigation1_1781666651854.py` |
| `Investigation2.py` | 1,322 | 83,483 | `9fb165a86cc4cb7f009b730ed1492a7215201c815abf6a46682b2faf8463a719` | يمر | بايثون صالح | `Investigation2_1781665423386.py`، `Investigation2_1781666651896.py` |
| `Investigation3.py` | 285 | 6,780 | `44dd10b2b90b5264ea1d8d013ce83a105448c82ba40f79fb504371346c1f64a5` | يفشل | غير صالح (رمز —) | `Investigation3_1781665423435.py`، `Investigation3_1781666651943.py` |
| `Investigation4.py` | 2,018 | 74,331 | `9b39ab4249f0d8bf6d7a48327f040bd5a3acd9283764c592b85bbb972c36b4f3` | يمر | بايثون صالح — 19 صنفاً و108 دالة | `Investigation4_1781665423527.py`، `Investigation4_1781666651987.py` |
| `Investigation5.py` | 1,896 | 61,865 | `ef88bbc33a170d9b4f31bd3e9d4b2a8c73bfbe705bcbbe75320f52bc25965915` | يفشل | غير صالح (فاصلة عربية) | `Investigation5_1781665423610.py`، `Investigation5_1781666652029.py` |
| `Investigation6.py` | 881 | 151,681 | `cd25ea415161467cd1058b3a0566860d74f120f91516de539de01b23822a4a07` | يفشل | غير صالح (أسطر طويلة جداً) | `Investigation6_1781665423655.py`، `Investigation6_1781666652073.py` |
| `Investigation7.py` | 1,971 | 62,821 | `0a57813b40db25c5ed054af1f2a25a907a4d0ba2a6b30e31cfcd213c9bffab79` | يفشل | غير صالح | `Investigation7_1781665423698.py`، `Investigation7_1781666652117.py` |
| `Investigation8.py` | 1,002 | 34,900 | `485fea113dbdd861dc90602ebc752be5305badf8834dc914fd8a4449ae350044` | يفشل | غير صالح | `Investigation8_1781665423739.py`، `Investigation8_1781666652163.py` |
| `Investigation9.py` | 32 | 835 | `975fc7490e5fd7fa710a7deba4f3a35068219b46a4da9d215161060c90c3c50d` | يمر | ليس بايثون: JSON لـ package.json من نسخة Next.js | `Investigation9_1781665423783.py`، `Investigation9_1781666652211.py` |
| `Investigation10.py` | 104 | 3,990 | `af05daf8ca8201ed38e16e9f9cdf126058885e66dfd11f18ea63fca8577ab95b` | يفشل | غير صالح | `Investigation10_1781665423826.py`، `Investigation10_1781666652258.py` |
| `Investigation11.py` | 124 | 3,400 | `70b3f78dce2b8fda56e9d25f9d96f0a50eff0c109387b11f551f1ac356723b39` | يفشل | غير صالح | `Investigation11_1781665423879.py`، `Investigation11_1781666652301.py` |
| `Investigation12.py` | 44 | 1,776 | `9b8079b7dd816ba2a2fcbda3ec2aa13f59b3e641b79321538dfd0d653d2e5947` | يفشل | ليس بايثون: شجرة مجلدات نصية | `Investigation12_1781665423924.py`، `Investigation12_1781666652344.py` |
| `Investigation13.directions.py` | 381 | 18,558 | `ae6a33cfd41d371cf5f6c617bcb3dfeeed466f4a9e051269551ba69271c793a0` | يفشل | غير صالح — تعليمات بالعربية | `Investigation13.directions_1781665423964.py`، `Investigation13.directions_1781666652387.py` |
| `pasted-notes.txt` | — | 15,924 | `3cfbf1da77f629dc0cdccca37ff3618453a6a0283495e0f73d87024afa493646` | — | نص ملصوق | `Pasted---1781666666134_1781666666136.txt` |

المجموع: 13 ملف بايثون فريداً، 11,563 سطراً. إعادة التحقق: `cd attached_assets/legacy && sha256sum *.py *.txt`.
