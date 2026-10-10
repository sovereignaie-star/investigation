> المصدر: `docs/references/master-tool-roadmap/` — مصنّف من الخريطة الأمّ الأصلية (2026-10-10).

# 4. سجل اكتشاف الأدوات (TOOL_DISCOVERY)


هذه قدرة ذات أولوية قصوى: أداة أو مجموعة خدمات تكتشف الأدوات الجديدة وتراجع المعروفة وتحدد ما لم نغطّه بعد.

## 4.1 مصادر الاكتشاف

1. **فهارس مرجعية:** OSINT Framework، DFIR Toolkit، قوائم Awesome المتخصصة، قوائم CERT/CSIRT ومؤسسات الأمن الرسمية.
2. **مستودعات الكود:** GitHub وGitLab ومصادر المشاريع الرسمية؛ البحث في الموضوعات والوسوم والإصدارات والالتزامات والمشكلات المفتوحة.
3. **مديرو الحزم:** npm، PyPI، crates.io، Maven Central، NuGet، RubyGems، Go modules، Conda، Homebrew، apt/dnf حسب النظام.
4. **سجلات الحاويات:** صور Docker/OCI الرسمية، مع فحص المنشأ والتوقيع والمكونات.
5. **واجهات API وكتالوجات البيانات:** صفحات المطورين الرسمية، OpenAPI، قوائم connectors، وكتالوجات feeds.
6. **معايير ومؤسسات:** NIST، CISA، MITRE، OASIS، IETF، FIRST، OWASP، CERTs، والمختبرات الأكاديمية.
7. **إشارات الصيانة:** إصدار جديد، تنبيه أمني، توقف مشروع، تغيير ترخيص، تغيير سعر/حصة، أو كسر توافق.
8. **اكتشاف من الاستخدام:** عندما تفشل أداة أو يطلب المستخدم قدرة غير متوفرة، افتح مهمة بحث للفجوة بدلاً من إسقاطها بصمت.

## 4.2 دورة الاكتشاف

`Discover → Deduplicate → Verify official source → Inspect license → Inspect activity & security → Test in isolated lab → Score → Decide USE/WRAP/EXTEND/BUILD/REJECT → Add to registry → Monitor changes`

## 4.3 بطاقة الفهرس

لكل أداة: `canonical_name`, `aliases`, `category`, `capabilities`, `official_url`, `source_repo`, `release_url`, `license`, `license_checked_at`, `last_commit_or_release`, `maintenance_state`, `install_method`, `interfaces`, `auth`, `cost_model`, `rate_limits`, `platforms`, `data_types`, `security_notes`, `privacy_notes`, `integration_status`, `test_status`, `replaced_by`, `reviewed_at`, `reviewer_or_agent_run`.

## 4.4 منع ادعاء الشمول الكاذب

أنشئ تقارير دورية: الأدوات الجديدة المكتشفة، أدوات توقفت، مصادر تغيّر ترخيصها أو API، قدرات ليس لها تغطية، الفئات التي لا توجد لها تغطية عربية، وفجوات الأدلة والاختبارات. لا تعرض «تغطية 100%» إلا نسبةً إلى معيار محدد ومعلن ومؤرخ.

---

