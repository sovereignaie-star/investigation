# حالة المشروع (STATUS) — المصدر الوحيد للحالة الحية

> **قاعدة GR-01:** هذا الملف يُحدَّث في **كل إيداع** مع إدخال جديد في `docs/WORKLOG.md`. الحالات المسموحة في عمود الحالة: `todo`، `in_progress`، `blocked`، `done`، `dropped`. لا تُكتب الحالة في `ROADMAP.md`.

## الملخص

| البند | القيمة |
|---|---|
| آخر تحديث | 2026-10-12 |
| المرحلة الحالية | 1 — النواة والسجل مكتملة (30/30). المرحلة 2 قيد التنفيذ على `main` (P2-001 وP2-003) وعلى PR #68 (P2-003 وP2-005). **ADR-08 معتمد تصميمياً منذ 2026-10-12 (PR #63)**؛ الاعتماد التصميمي لا يعني اجتياز القبول الأمني: بوابة T-SBX (G-15) لم تتحقق، وD-8 غير مفروض على `main` |
| الإصدار | لا إصدار بعد (`0.0.0`) |
| آخر إيداع محدِّث | `git log -1 -- docs/STATUS.md` |
| ملخص الحالة | (2026-10-12، PR #68 على `fix/p2-003-d8-canary`، غير مدمج) **الخروج:** كل حالات T-SEC-SSRF-001..048 لها اختبار؛ 40 مُثبتة كاملاً و8 جزئياً و0 غير مُثبتة، بالتفصيل في `docs/adr/reference/T-SEC-SSRF-COVERAGE.md` (لا نسبة إجمالية)، مع اختبارات طفرة تثبت أن إزالة كل ضابط تُفشل حالاته. **العزل T-SBX:** مرشح seccomp في النواة بدل `LD_PRELOAD`، وعزل ملفات بـ `bwrap` حيث تتاح مساحات أسماء المستخدم؛ الافتراضي يرفض التشغيل إن لم يثبت العزل الكامل؛ G-15 لم تتحقق (`docs/security/T-SBX_ENFORCEMENT.md`). **D-8:** `CODEOWNERS` يسمي المراجع المستقل وحده على 13 مساراً (البديل 2)، وقيس على فرع تجريبي محمي: بصفر موافقات يمنع طلب D-8 (#69، #72 حتى مع تعديل `CODEOWNERS` نفسه) ويسمح بغيره (#70)؛ «موافقة آخر دفع» تمنع الكل فلا تُفعَّل؛ حماية `main` لم تُفعَّل بعد (0 موافقات، بلا مراجعة مالكي الكود)، ودمج PR #68 نفسه ينتظر موافقة `@xuuux-voox` على رأسه. **D-052:** لم يُعَد إنتاج فشل المهلة في التجربة المضبوطة (PR #67)؛ السبب غير مثبت؛ لا تغيير في KDF ولا في مهلة 5000 ms. **العيب D-055** (تجاوز حارس الأصل نفسه في `custom-fetch.ts` على `main`) مُصلح في PR #68. الاختبارات: `pnpm test` => 51 ملفاً، 797 ناجحاً و2 متخطيان (على Linux 6.1 مع seccomp و`bwrap`؛ العدد يختلف حيث لا يتوفر `bwrap`) |

## تقدم المراحل

| المرحلة | العنوان | المهام | منجزة | قيد التنفيذ |
|---|---|---|---|---|
| 0 | التثبيت والتأسيس | 29 | 29 | 0 |
| 1 | النواة والسجل | 30 | 30 | 0 |
| 2 | المحرّك والمحوّلات | 31 | 0 | 3 |
| 3 | محطة العمل | 25 | 0 | 0 |
| 4 | ذكاء التحليل | 23 | 0 | 0 |
| 5 | العربية وكتب الإجراءات والتقارير والذكاء الاصطناعي | 27 | 0 | 0 |
| 6 | التقوية والنسخة التجريبية | 15 | 0 | 0 |
| 7 | الإطلاق والتشغيل | 11 | 0 | 0 |
| 8 | آفاق ما بعد GA (لا تُحتسب في GA) | 24 | 0 | 0 |

> يُحدَّث جدول «تقدم المراحل» مع كل تغيير حالة.

## المهام

### المرحلة 0: التثبيت والتأسيس

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P0-001 | تفعيل الحوكمة: القواعد، حارس الوثائق، خطافات git، فحص CI، حماية الفرع (M) | done | PR #1 (الحارس + الخطافات + CI) + حماية `main` مفعّلة: فحص `governance` مطلوب، PR إلزامي، enforce_admins، لا دفع قسري، تاريخ خطي |
| P0-002 | إكمال خارطة الطريق وإنشاء ملف الحالة وسجل العمل (M) | done | إيداع الحوكمة الأول: `docs/ROADMAP.md` (الأقسام 0–13 والملاحق) |
| P0-003 | كتالوج الأدوات (أكثر من 5,000 أداة حقيقية) وخط بنائه (M) | done | إيداع الحوكمة الأول: 10,814 أداة في `docs/tools/` |
| P0-004 | إصلاح `identifierList.ts` المعطوب (M) | done | PR #2: حُذف المثال المعطوب (79.8KB من الحرف w) وأغلقت المصفوفة؛ 370 نوعاً + onion_v3 سليم |
| P0-005 | إصلاح خطأ `TS2352` ومفتاح الكاش (M) | done | PR #2: جدول كاش جديد بمفتاح أساسي cacheKey (Dexie v2) و`put` بدل التحويل string→number؛ `pnpm run typecheck` => exit 0 |
| P0-006 | نقطة دخول دنيا للواجهة (`main.tsx`، `App.tsx`) بواجهة عربية RTL (M) | done | PR #3: `main.tsx` + `App.tsx` + `index.css`؛ `BASE_PATH=/ pnpm run build` => نجاح (30 وحدة، 82KB gzip) |
| P0-007 | نظافة الأسرار: `.gitignore` للبيئة و`.env.example` (M) | done | PR #3: `.gitignore` يحظر `.env` و`.env.*` مع استثناء `.env.example`؛ `git check-ignore .env` => مطابق |
| P0-008 | ملفات المشروع: README، LICENSE، SECURITY، CONTRIBUTING، CODE_OF_CONDUCT (M) | done | PR (هذا الفرع): README وLICENSE (نص AGPL-3.0 الرسمي، 661 سطراً) وSECURITY وCONTRIBUTING وCODE_OF_CONDUCT في الجذر ومترابطة؛ package.json => AGPL-3.0-or-later؛ الإبلاغ الخاص عن الثغرات مفعّل |
| P0-009 | تثبيت بيئة التشغيل: `engines` و`.nvmrc` و`packageManager` (M) | done | PR #3: `engines` (node>=24، pnpm>=10) و`packageManager: pnpm@10.34.6` و`.nvmrc`=24 |
| P0-010 | إطار الاختبار Vitest وأول اختبارات (سلامة قائمة المعرّفات) (M) | done | PR #3: Vitest 3 + `vitest.config.ts`؛ `pnpm test` => 2 ملفات، 8 اختبارات ناجحة (T-IDL-001..006 واستيراد `@workspace/db`) |
| P0-011 | خط CI للبناء: تثبيت، فحص أنواع، بناء، اختبار (M) | done | PR #3 دمج `ci.yml`؛ أول تشغيل: build ✓ (20 ث)، test ✓ (17 ث)؛ ثم صارت `governance` و`build` و`test` فحوصاً مطلوبة لحماية `main` |
| P0-012 | تنظيف نصوص القالب: ملف وصف القالب و`index.html` (`lang="ar" dir="rtl"`) (M) | done | PR #1 (ملف وصف القالب) + PR #3 (`index.html`: `lang=ar dir=rtl`، وصف حقيقي، `noindex`، إزالة خطوط Google الخارجية) |
| P0-013 | إصلاح `post-merge.sh` (اسم الحزمة) (S) | done | PR #3: اسم الحزمة صريح، وتخطي `drizzle push` بلا `DATABASE_URL` |
| P0-014 | جعل `lib/db` كسولاً (لا يرمي خطأ عند الاستيراد) (S) | done | PR #3: `getDb()`/`getPool()` كسولان؛ لا خطأ عند الاستيراد (اختبار في P0-010) |
| P0-015 | سجلات القرار الأولى ADR-01/02/03/10/11/13/19/20 (M) | done | PR (هذا الفرع): docs/adr/ بـ 12 ملفاً للقرارات المقررة (01، 02، 03، 10، 11، 13، 14، 19، 20، 21، 22، 23) بالصيغة المعتمدة + فهرس README |
| P0-016 | إزالة تكرار ملفات بايثون المرفقة وجردها ببصماتها (S) | done | PR (هذا الفرع): 26 ملفاً => 13 فريداً في attached_assets/legacy/ بأسماء نظيفة + MANIFEST.md ببصمات SHA-256؛ 11,563 سطراً و3 ملفات بايثون صالحة + Investigation9 (JSON) يطابق الخارطة 2.9 |
| P0-017 | فحوص أمن آلية: Dependabot، CodeQL، gitleaks (S) | done | PR (هذا الفرع): dependabot.yml (npm + actions أسبوعياً)، codeql.yml (security-extended على كل PR وmain وأسبوعياً)، secrets.yml (gitleaks 8.30.1 مثبّت ببصمة)؛ فحص كامل التاريخ: 33 إيداعاً بلا تسريب بعد استثناء موثق واحد (رأس PEM مثالاً) |
| P0-018 | قوالب Issues وPR تتضمن قائمة الحوكمة (S) | done | إيداع الحوكمة الأول: `.github/pull_request_template.md` وقوالب Issues |
| P0-019 | سكربت قياس خط الأساس يعيد أرقام القسم 2 (S) | done | scripts/audit/measure.mjs + pnpm run audit:measure; reproduces 1.2 (31/371 fetchers, 14/377 first-match, 11,563 py lines, 3 valid) |
| P0-020 | ملف تعليمات الوكلاء الآليين (`AGENTS.md`) (M) | done | إيداع الحوكمة الأول: `AGENTS.md` |
| P0-021 | دمج الخطة الشاملة (`MASTER_PLAN.md`) مع الخارطة: قاعدة أسبقية، سجل حسم التعارضات، مصفوفة تتبع، وحارس GR-16 (M) | done | PR (هذا الفرع): docs/MASTER_PLAN.md مدمجة (3,569 سطراً، 0 مربعات)، الأصل في docs/archive بـ SHA-256، القسم 14 في الخارطة (39 تعارضاً محسوماً، ربط 21 مرحلة، 46 مهمة و11 محوّلاً جديداً)، check --consistency أخضر |
| P0-022 | جودة الكود الثابتة: ESLint (typescript-eslint strict) وPrettier و`.editorconfig` وسكربت `lint` في CI (M) | done | eslint.config.mjs (strict, complexity 15, no-console, no-explicit-any) + .prettierrc.json + .editorconfig + lint-staged pre-commit + Conventional Commits in guard (T-GOV-013/014) + lint step in CI |
| P0-023 | دليل التطوير وتشغيل المشروع في أقل من 10 دقائق (S) | done | docs/DEVELOPMENT.md + .vscode/extensions.json; fresh clone to dev+healthz in 158 s |
| P0-024 | إعدادات المستودع: `CODEOWNERS`، تسميات منظمة، الإبلاغ الخاص عن الثغرات، فحص الأسرار في GitHub (S) | done | CODEOWNERS + labels.yml (25 labels applied); secret scanning + push protection, private vuln reporting, Dependabot alerts + security updates enabled via gh api |
| P0-025 | `ARCHITECTURE.md` مختصر يحيل إلى القسم 5 وسجلات القرار (S) | done | ARCHITECTURE.md: links to ROADMAP 5.x anchors and docs/adr, current vs target layout |
| P0-026 | دمج «المرجع الشامل لقدرات OSINT» (المرجع الثاني) (M) | done | 14.7 + P2-028..030 + P4-018..022 + TR-054..080 + curated.json (20 tools, catalog 10,834) |
| P0-027 | دمج تحديثات Dependabot لإجراءات GitHub في إيداع محكوم واحد، وحل تعارضاتها (S) | done | PRs #6-#8 folded into one governed commit: checkout v7, setup-node v7, pnpm/action-setup v6 in all workflows |
| P0-028 | دمج «ترسانة الأدوات والقدرات» (PR #9) (M) | done | docs/tools/ARSENAL.md generated by tools/catalog/arsenal.py (517 tools: 105 in roadmap, 26 stack, 219 catalog, 151 candidates, 8 defunct, 8 excluded); 14.8; TR-081..088; 7 tasks; catalog 10,881 |
| P0-029 | دمج تحديثات npm من Dependabot (#10، #12–#14) بملف قفل واحد (S) | done | #10 (54 minor/patch), #12 vite 8.3.4, #13 chokidar 5, #14 vitest 5.0.3 merged with one regenerated lockfile; #11 recharts 3 deferred (breaks shadcn chart.tsx), ignore rule added |

### المرحلة 1: النواة والسجل

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P1-001 | إعادة هيكلة مساحة العمل إلى `apps/*` و`packages/*` (M) | done | artifacts/* -> apps/{web,server,sandbox} renamed @ir/*; packages/* opened; lint/typecheck/build/test/audit green; /api/healthz ok |
| P1-002 | `@ir/schema`: مخططات Zod لنموذج 5.4 (M) | done | packages/schema: Zod v4 models for all 11 entities of 5.4 + JSON Schema 2020-12 in packages/schema/json; 19 tests |
| P1-003 | نقل بيانات المعرّفات إلى YAML بالمخطط الجديد (M) | done | packages/core/identifiers/*.yaml (371 types, 13 categories incl. new Messaging) -> generated src/identifiers/catalog.ts; IdentifierSpec schema; web identifierList.ts is now a 40-line adapter; catalog.test.ts T-IDL-001..004 + sync; PEM header example is a template too |
| P1-004 | إصلاح الأنماط والأمثلة غير المتطابقة (M) | done | 78 failing examples/patterns fixed (truncated samples, scheme-less social URLs, phone ranges, ipv6, mx_record); 100% of positives accepted by pattern+validator; one negative per type rejected (templated for secret-shaped types); wickr_id context-required |
| P1-005 | المدققات: Luhn، IBAN، EIP-55، Base58Check، Bech32، IP، PSL (M) | done | @ir/core/validate + @ir/core/psl: Luhn, IBAN (SWIFT registry, 89 countries), ISIN, EIP-55 (pure Keccak-256), Base58Check, Bech32/Bech32m, Bitcoin addresses, IPv4/IPv6, PSL; official vectors (BIP-173/350, EIP-55, Bitcoin Core key_io/base58, test_psl.txt); 62 core tests |
| P1-006 | محرك الكشف متعدد المرشحين بدرجات وسياق (M) | done | packages/core/src/identifiers/detect.ts: detect(value,{context,limit,minScore}) ranked candidates (validator veto+weight, data-measured specificity, context keywords/labels, context.required); recall 100%, validated types 33/33 first/tied/behind-narrower; web uses detectBest/detect |
| P1-007 | التطبيع والمفتاح القانوني (M) | done | packages/core/src/normalize.ts: normalize()/canonicalKey() for 371 type ids by family; 100,000 distinct inputs -> 100,000 keys, all variants map back; smartInvestigator uses it |
| P1-008 | تصنيف الحساسية لكل نوع (M) | done | sensitivity on every type: 52 identity-document types natural_person_gate, cnpj_br (legal entity) normal; test D-011 |
| P1-009 | `@ir/ledger`: سلسلة تجزئة + JCS (M) | done | packages/ledger: RFC 8785 JCS, SHA-256 hash chain (ADR-06), append-only Ledger, verify(); T-LED-001..010 green (28 tests, 993 single-char edits all detected) |
| P1-010 | مخزن الأدلة بعنونة المحتوى (M) | done | packages/ledger blobs.ts + evidence.ts: blobs/<sha[0:2]>/<sha> zstd, hash verified on every read, atomic idempotent put, request redaction, evidence.stored + verifyEvidence; T-LED-016..019 green؛ **أُصلح السبب الجذري لفشل T-LED-016 (2026-10-11)**: خانة Last_Block في ترويسة كتلة zstd لا تغيّر البايتات المفكوكة فكان تجزئة المحتوى وحدها لا يرى العبث؛ أُضيف تحقق بنيوي صارم للإطار قبل الفك (`assertZstdFrameIntact`: التحقق من السحر، تحليل Frame_Header_Descriptor وFCS وDictionary_ID حسب RFC 8878، وتقفّي كل كتلة مع فحص Last_Block والحجم والنوع وحصر البايتات اللاحقة) فيُرفض التلاعب بأي بايت ترويسة (بما فيه بت Last_Block) كـ corrupt بلا اعتماد على التجزئة؛ 56 اختباراً في ledger (236/236 على مساحة العمل)؛ **المقارنة التشغيلية لأمر CI (نفس Node 24.10.0 ونفس أمر test:coverage)**: main يفشل حتمياً في T-LED-016 (بايت 6، 36.5s) و#48 يفشل بنفس الفشل الموروث وaudit-purpose.test.ts يمر في 523-592ms، و#50 يعالجه وينجح 236/236 في 38.6s؛ وبعد قراءة RFC 8878 الرسمية صُحح ثلاثة أخطاء في قراءة Frame_Header_Descriptor (Content_Checksum في البت 2 لا 3، Dictionary_ID_Flag بِتان 0-1 بأحجام 0/1/2/4 بايت لا بِتاً واحداً بأربعة بايت، وترتيب الحقول Window_Descriptor ثم FCS ثم Dictionary_ID) وأضيف اختبار يبني إطارات اصطناعية لكل تنويعات الترويسة الـ32 (checksum × قاموس × Single_Segment × FCS code) ويثبت أن المحقق يقبل كل إطار صالح ويقرأ الكتلة من الموضع الصحيح، وأن أي اقتطاع يُرفض؛ وفُصل خطأ التحقق البنيوي عن خطأ الفك في رسالة الرفض؛ وبعد مراجعة مستقلة أُضيفت: قراءة Window_Descriptor عند Single_Segment=0 وقراءة بت 21 كاملاً من Block_Size واختبارات لثلاثة أنواع كتل (Raw/RLE/Compressed) وإطارات متعددة الكتل واقتطاعها وتغيير ترويسة خارج قناعي 0x01/0x80 مع إثبات استقلال مسبأ المحتوى المتطابق |
| P1-011 | التوقيع بـ Ed25519 ونقاط التثبيت (M) | done | packages/ledger signing.ts + merkle.ts: Ed25519 installation key (single open, 0600, fd-only I/O), ir-checkpoint/1 signed over JCS with RFC 9162 Merkle root, embedded + external verification, inclusion proofs; T-LED-011..015 green |
| P1-012 | أمر `ir verify` (M) | done | packages/cli (ir verify, bundled dist/ir.mjs, in Docker image) + @ir/store verifyCase/formatReport: chain, evidence re-hash, embedded and published checkpoints, exit 0/1/2, --json; 4 tests |
| P1-013 | تخزين القضية SQLite + ترحيلات (M) | done | packages/store: node:sqlite case dir (case.sqlite + blobs), 3 checksummed migrations (user_version, drift/newer/gap refused, failed step rolled back), append-only triggers, SqliteLedgerStore, openCase; 6 tests (empty->latest, every vN->latest equals fresh) |
| P1-014 | تشفير القضية (SQLCipher أو تشفير ملفات) واشتقاق المفتاح (M) | done | packages/store crypto.ts: Argon2id (RFC 9106 vector) wrapped per-case key, AES-256-GCM sealed payloads and HMAC-addressed blobs; reading without key fails; ir verify --passphrase-file; 8 tests; no check-then-read on case.key.json (CodeQL js/file-system-race fixed in code) |
| P1-015 | خزنة المفاتيح في الخادم (M) | done | packages/store vault.ts (AES-256-GCM per entry, name as AAD; master from IR_VAULT_KEY / IR_VAULT_PASSPHRASE / generated 0600 key file); /api/vault never returns a secret; keyed lookups server-side; IR_ADMIN_TOKEN or loopback; web off localStorage; 7 tests and docker CI check |
| P1-016 | الإسقاطات: رسم، جدول، تغطية (M) | done | packages/ledger/src/projections: pure Projector reducer -> graph/table/coverage views, snapshot(upTo), projectionHash (JCS SHA-256); Case.projection() live on append, reset on rollback; ir project [--at] [--expect] incl. encrypted cases; live == rebuild after each of 600 random events, plain+encrypted reopen equal; 10k nodes/20k edges in ~0.15 s |
| P1-017 | سجل التدقيق (M) | done | Case.audit(): AuditEvent (purposeRef = case id) appended as audit.event in the chain and indexed in audit_events in one transaction; created, updated, evidence.stored, unlocked, passphrase_changed audited; detail sealed in encrypted cases; ir verify cross-checks index vs chain |
| P1-018 | غرض القضية والأساس المشروع (M) | done | openCase requires create (CaseInit: purpose >= 10 chars, closed legalBasis) else NoCaseError; case.created is the first entry; info()/update(changes, reason) via case.updated; refused case writes nothing; tests in audit-purpose.test.ts |
| P1-019 | ساعة ومولّد قابلان للحقن (S) | done | packages/core: Clock (system/manual), Random (crypto/seeded), monotonic ULID factory; 6 tests; ESLint bans Date.now/new Date()/Math.random in core, schema, ledger |
| P1-020 | مجموعة ذهبية للكشف (5,000 مثال) (M) | done | fixtures/detect/golden.jsonl: 5,000 snippets (ar/en), 6,533 deterministic + 3,025 other entities, 800 near misses; independent generator self-checked on published vectors; golden.test.ts second review + extractor scores: deterministic precision 99.97%, recall 99.97%, near misses 0 accepted, other recall 97.5%; linear punctuation trimming (CodeQL #25 fixed in code) |
| P1-021 | إزالة `persist` من Zustand لبيانات المجال (M) | done | apps/web store is in-memory (no zustand persist); storagePolicy.purgeLegacyCaseStorage() deletes 'investigation-store' at start-up; investigationStore.test.ts: no localStorage/sessionStorage writes, purge, source guard; verified in headless Chromium (keys after reload: []) |
| P1-022 | فهارس O(1) للعقد والحواف في الإسقاطات (S) | done | PR #36 (9a43aeb); updateNode contract = ADR-25 (P1-027 PR): Projector merge index = incremental union-find with path compression, rebuilt only on revert or a late alias of a merge-named id; web store IdIndex (O(1) lookup) + addNodes/addEdges; 100,000 nodes projected in 0.47 s, 5,000 chained merges 0.02 s (was 76 s for 2,000), web batch 100k nodes + edges < 2 s; live == rebuild with late aliases (D-051) |
| P1-023 | إصلاح تنبيهات CodeQL الموروثة في الكود المنقول (S) | done | VideoNode hostname check; sandbox preview escaping; normalize.ts family regexes split into fully anchored patterns (js/regex/missing-regexp-anchor) |
| P1-024 | إزالة الاعتماد على منصة الاستضافة السابقة وتشغيل مستقل عبر Docker وRender وRailway وجهاز محلي (S) | done | legacy hosting files removed; Dockerfile + render.yaml + railway.json; server serves web build (rate-limited 600/min/client); CI docker job green |
| P1-025 | إغلاق تنبيهات CodeQL القديمة على main (S) | done | set-status.mjs: IDs validated (D-nnn, G-nn, Pn-nnn) and escaped before RegExp; custom-fetch: linear trailing-slash trim; alerts 1,3-6 resolved, 13-15 (localStorage keys) left for P1-015 |
| P1-026 | حصر حدود الوصول للخزنة والاستعلامات المموّلة بالمفاتيح (M) | done | token إلزامي، CORS مغلق، lookup POST منقح، سياسة HOST مختبرة، وفحص Docker محدث لرمز الإدارة؛ lint/typecheck/test/build خضراء تحت Node 24.21.0. |
| P1-027 | قياس بوابات خروج المرحلة 1 (G-08..G-13) وأتمتتها | done | PR #37: scripts/gates/phase1.ts (pnpm run gates:phase1) measures G-08..G-13 on a real build; CI job gates; test:coverage enforces 85% lines per core package (reportOnFailure); negative controls: coverage 99.9% -> exit 1, injected browser key call -> G-11 FAIL؛ D-053 (PR #38): مهلة صريحة 30 ث لثلاثة اختبارات ثقيلة، والسكربت يطبع رسالة الفشل الحقيقية، وفحص شبكة فعلي للواجهة في Chrome بلا واجهة (G-11)، وفحص G-12 أوسع؛ أُغلق بخمسة تشغيلات `gates` خضراء متتالية على `main` عند `bf114ec`، ثم صارت `gates` فحصاً مطلوباً (D-1)؛ تنبيه CodeQL js/unvalidated-dynamic-method-call على PR #38 عولج بمنتظر واحد متسلسل |
| P1-028 | إنشاء القضية ذرّياً والتحقق من سجل الغرض | done | PR (هذا الفرع): case identity + case.created + audit in one transaction; IncompleteCaseError on writable open of a chain without case.created; ir verify reports purpose; crash at every clock read 1..40, plain and encrypted, leaves no case and no key file |
| P1-029 | فرز تنبيهات Dependabot وسياسة مهلها (D-3) | done | PR #39: `docs/security/DEPENDENCY_ALERTS.md` يسجل الـ 23 تنبيهاً؛ 11 من 12 حرجاً وعالياً مُصلحة في ملف القفل (`proxy-addr` 2.0.8، `fast-uri` 3.1.8، `browserslist` 4.29.3، `brace-expansion` 5.0.12)؛ `braces` (#54) استثناء موثق بلا إصلاح منشور، يُراجع 2026-10-17؛ السياسة في SECURITY.md |
| P1-030 | تعطيل `/api/lookup/*` افتراضياً خلف علم صريح (D-2) | done | PR #38: `IR_ENABLE_LOOKUPS=1` حرفياً يفعّلها و`IR_OFFLINE=1` يعطّلها دائماً؛ 403 بلا قراءة الخزنة؛ اختبار بشاهدين (`fetch` المحقون والعام) لثلاث حالات تعطيل؛ ضابط سلبي (`return true`) -> 4 اختبارات تفشل |

### المرحلة 2: المحرّك والمحوّلات

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P2-001 | `@ir/engine`: طابور، ميزانيات، إلغاء لكل تشغيل (M) | in_progress | على `main` (PR #66، `6da8ec8` و`b181d6d`): `packages/engine` (طابور، ميزانيات، إلغاء لكل تشغيل، منفذ نقل ضيق) ومهايئ البوابة `egress-adapter.ts`. في PR #68: المهايئ يحوّل `transport_error` إلى `transport:network` و`content_encoding` إلى `transport:http-error`، ولا تُحتسب استجابة متأخرة بعد الإلغاء نجاحاً؛ اختبارات إلغاء أثناء الطلب (نقل يحترم الإشارة ونقل يتجاهلها) في `packages/engine/src/egress-adapter.test.ts`. لا اتصال حقيقي من المحرك قبل اكتمال P2-003 وT-SBX. التاريخ المفصل في `docs/WORKLOG.md` |
| P2-002 | الحواف لكل الآباء وادعاءات بنوع علاقة (M) | todo | — |
| P2-003 | `@ir/egress`: بوابة عام للإنترنت العام، SSRF، حدود، حد معدل، مهلات (M) | in_progress | على `main`: `@ir/egress` (PR #66). في PR #68 (غير مدمج): (1) سياسة: قائمة سماح حرفية (`[]` يمنع الكل، غيابها = النمط العام)، تطبيع IDNA والنقطة الأخيرة بلا أحرف بدل، سجل مضيفي كل مزود للأسرار (`secret_host_mismatch`)، `IR_OFFLINE=1` يُقرأ لكل طلب ولا يُتجاوز، حساسية مفقودة = `unclassified_data`، مهلة كلية تشمل DNS ونقلاً يتجاهل الإشارة، حد معدل لكل قفزة، سقف الحجم على البايتات الفعلية، أخطاء نقل منقّحة. (2) النقل: فك ترميز متراكب بحد طبقتين وسقف بعد الفك، ترميز مجهول أو تالف = `content_encoding`، تجاهل وكيل البيئة، تحقق TLS باسم الرابط لا بالعنوان المثبت. (3) مسار اختبار الخزنة: قدرة مجمدة برمز محلي، وسجل مضيفين لكل مزود، و401/403/500 بلا تسريب، وتدقيق مسلسل عبر pino حقيقي مع ضابط سلبي. (4) `custom-fetch.ts`: قرار الأصل نفسه بمحلل WHATWG (D-055). (5) فحص AST `no-direct-network` يكشف `require`/`import()` غير الحرفيين و`createRequire` و`process.binding`/`dlopen` و`inspector` و`vm` وملفات `.js/.mjs/.cjs`؛ وهو أداة مراجعة لا عزل تشغيل. (6) المصفوفة: `ssrf-matrix.test.ts` و`ssrf-mutation.test.ts` و`node-transport-ssrf.test.ts` و`ssrf-coverage-doc.test.ts`. **جزئي:** 001 و020 و040 (سبب الرفض يخالف نص المواصفة)، 023 و034 (بلا طفرة)، 042 (لا تقييد مسار لكل مزود)، 043 (لا فحص لمحتوى الطلب)، 045. robots.txt غير منفذ (لا محوّل يجلب صفحات بعد). D-8: البديل 2 مُعدّ في `CODEOWNERS` ومقيس على فرع تجريبي (`docs/security/D8_ENFORCEMENT_OPTIONS.md`، القسم «القياس»)، غير مفروض على `main`؛ الدمج ينتظر موافقة `@xuuux-voox`. الطلبات القديمة: كود #47 و#48 و#60 و#61 و#64 موجود على `main` (الأسطر الناقصة تصاميم استُبدلت)، وأدلة #62 في WORKLOG على `main`، وكود بوابة #42 منقول حرفياً إلى PR #68 (يُغلق #42 بعد دمجه). الأمر: `pnpm exec vitest run packages/egress apps/server/src/routes/vault.test.ts` |
| P2-004 | واجهة المحوّل وبيان القدرات (M) | todo | — |
| P2-005 | عزل المحوّلات بـ worker_threads (M) | in_progress | PR #68 (غير مدمج): `packages/sandbox` (اسم الحزمة `@ir/transform-sandbox`) — مُشغّل seccomp-BPF في النواة (يحل محل `LD_PRELOAD` الذي كان اعتراضاً في مساحة المستخدم) مع `bwrap --unshare-all` لعزل الملفات والعمليات حيث يتاح؛ فحص حي للمستوى قبل كل تشغيل، والافتراضي `full` يرفض التشغيل إن لم يثبت؛ T-SBX-001..012 في `packages/sandbox/src/tsbx.test.ts` لكل مستوى مع ضوابط سلبية. **لم تتحقق G-15:** رفض استدعاءات النظام لا يُسجَّل في التدقيق، وعزل الملفات غير مُثبت في CI حتى الآن (run 38289343370: `full=false`، bubblewrap غير مثبت؛ أضيف تثبيته)، وغير موصول بمحوّلات لأن P2-004 `todo`. التفاصيل: `docs/security/T-SBX_ENFORCEMENT.md` |
| P2-006 | الدليل السلبي وأسباب الفشل (M) | todo | — |
| P2-007 | الكاش بمفتاح idempotency وTTL المصدر (M) | todo | — |
| P2-008 | `@ir/sim`: خادم محاكاة حتمي لكل المحوّلات (M) | todo | — |
| P2-009 | محوّلات الدفعة الأولى (DNS، RDAP، شهادات، IP، ASN) TR-001..TR-010 (M) | todo | — |
| P2-010 | محوّلات الدفعة الثانية (أرشيف، GitHub، بلوكتشين) TR-011..TR-020 (M) | todo | — |
| P2-011 | محوّلات الدفعة الثالثة (شركات، عقوبات، بيانات مفتوحة) TR-021..TR-030 (M) | todo | — |
| P2-012 | محوّلات الدفعة الرابعة (وسائط، EXIF، مستندات) TR-031..TR-040 (M) | todo | — |
| P2-013 | بوابة الأشخاص الطبيعيين في المحرك (M) | todo | — |
| P2-014 | سجل الشبكة لكل قضية (M) | todo | — |
| P2-015 | اختبار المفاتيح لكل مزوّد يدعم ذلك (S) | todo | — |
| P2-016 | المفاتيح في الترويسات لا في الروابط (M) | todo | — |
| P2-017 | خريطة التغطية (واجهة برمجية) (M) | todo | — |
| P2-018 | وضع الإعادة بلا شبكة (M) | todo | — |
| P2-019 | واجهات REST + SSE للمحرك في OpenAPI (M) | todo | — |
| P2-020 | تقوية الخادم: CORS مقيد، helmet، حد معدل، حد حجم، جلسة محلية (M) | todo | — |
| P2-021 | خط اعتماد الأدوات من الكتالوج إلى محوّل (S) | todo | — |
| P2-022 | `ir` CLI: تشغيل محوّل وتوسيع من سطر الأوامر (C) | todo | — |
| P2-023 | استراتيجيات التوسع والأولويات وقواعد التوقف (S) | todo | — |
| P2-024 | أرصدة المفاتيح وتعدد المفاتيح للمصدر الواحد وتنبيهات الاقتراب من الحد (S) | todo | — |
| P2-025 | إعادة المحاولة بتراجع أسي حسب صنف الخطأ، وإعادة تشغيل عقدة أو فرع فاشل يدوياً (S) | todo | — |
| P2-026 | محوّلات الدفعة الخامسة: مصادر الخطة الشاملة بمفاتيح المستخدم TR-043..TR-053 (S) | todo | — |
| P2-027 | محلّل رسائل البريد EML/MSG: الترويسات، مسار الخوادم، الروابط، المرفقات وتجزئاتها (S) | todo | — |
| P2-028 | طبقة خصوصية المحقق: توجيه طلبات المحوّلات عبر وكيل HTTP أو SOCKS5 أو Tor اختيارياً لكل قضية أو لكل محوّل، مع قوائم وكلاء وفحص حيويتها وتدوير منضبط وتحكم في التأخير (S) | todo | — |
| P2-029 | تحكم المحقق في المصادر: إلغاء الطلبات الجارية، تعطيل أي مصدر بنقرة، إحصاءات لكل مصدر (نجاح، فشل، زمن، تكلفة)، ورابط مباشر للحصول على المفتاح من صفحة إدارة المصادر (S) | todo | — |
| P2-030 | محوّلات الدفعة السادسة: مصادر المرجع الثاني TR-054..TR-080 (S) | todo | — |
| P2-031 | استيراد المستقبِلات المحلية: ADS-B من readsb/dump1090 (JSON) وAIS من AIS-catcher (NMEA/JSON) كملاحظات بدليل ومصدر ووقت (C) | todo | — |

### المرحلة 3: محطة العمل

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P3-001 | استخراج `@ir/ui` من mockup-sandbox (M) | todo | — |
| P3-002 | الهيكل العام: تخطيط، تنقل، سمات، RTL (M) | todo | — |
| P3-003 | شاشة القضايا (إنشاء بغرض، فتح، أرشفة) (M) | todo | — |
| P3-004 | شريط الإدخال ورافع الملفات ومحدد المعرّفات (M) | todo | — |
| P3-005 | لوحة الرسم الكبيرة (Sigma.js) (M) | todo | — |
| P3-006 | لوحة صغيرة تحريرية (`@xyflow/react`) (S) | todo | — |
| P3-007 | التخطيط في Web Worker وحفظ المواضع (M) | todo | — |
| P3-008 | لوحة تفاصيل العقدة بالادعاءات والأدلة والثقة (M) | todo | — |
| P3-009 | عرض الجدول مع فرز وتصفية افتراضية (virtualized) (M) | todo | — |
| P3-010 | عرض الأدلة (عارض خام آمن) (M) | todo | — |
| P3-011 | تقدم التشغيل الحي (SSE) والإلغاء (M) | todo | — |
| P3-012 | إحصاءات القضية (S) | todo | — |
| P3-013 | إعدادات المفاتيح (الخزنة) (M) | todo | — |
| P3-014 | قائمة التصدير (M) | todo | — |
| P3-015 | التحقيقات المحفوظة (M) | todo | — |
| P3-016 | إعادة كتابة عقد النتائج الثماني على نموذج العرض الجديد (S) | todo | — |
| P3-017 | i18n كامل (ar/en) وقاعدة lint للنصوص المضمنة (M) | todo | — |
| P3-018 | الوصول: لوحة المفاتيح، القارئ، التباين (M) | todo | — |
| P3-019 | ميزانية الحزمة وتقسيم الشيفرة (M) | todo | — |
| P3-020 | E2E Playwright على المحاكاة لـ UC-01..UC-06 (M) | todo | — |
| P3-021 | لوحة الأوامر (Ctrl/Cmd+K) واختصارات لوحة المفاتيح الموثقة والقائمة السياقية للعقدة (S) | todo | — |
| P3-022 | التراجع والإعادة (Undo/Redo) لعمليات الواجهة (S) | todo | — |
| P3-023 | الحالات الفارغة والتحميل والخطأ: حد خطأ عام، `Suspense`، هياكل تحميل (S) | todo | — |
| P3-024 | Storybook لمكونات `@ir/ui` واختبارات انحدار بصري بلقطات RTL وLTR وداكن وفاتح (S) | todo | — |
| P3-025 | خطوط عربية ولاتينية مستضافة محلياً (مثل IBM Plex Sans Arabic وNoto Sans Arabic) (S) | todo | — |

### المرحلة 4: ذكاء التحليل

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P4-001 | نموذج الثقة 5.13 مع التفسير (M) | todo | — |
| P4-002 | تدريج Admiralty للمصادر والمحوّلات (M) | todo | — |
| P4-003 | كشف الاستقلال (المصادر الأصلية والمرايا) (M) | todo | — |
| P4-004 | دمج الكيانات: الحجب والمقارنة والأوزان (M) | todo | — |
| P4-005 | واجهة مراجعة الدمج والتراجع (M) | todo | — |
| P4-006 | الزمن ثنائي البعد في المخطط والإسقاطات (M) | todo | — |
| P4-007 | عرض الخط الزمني (M) | todo | — |
| P4-008 | اللقطات والمقارنة (M) | todo | — |
| P4-009 | المراقبة المجدولة والتنبيهات (S) | todo | — |
| P4-010 | واجهة خريطة التغطية (M) | todo | — |
| P4-011 | تحليلات الرسم: المركزية، المجتمعات، أقصر مسار (S) | todo | — |
| P4-012 | عرض الخريطة الجغرافية (MapLibre + بلاطات قابلة للتهيئة) (S) | todo | — |
| P4-013 | تصدير/استيراد FtM (M) | todo | — |
| P4-014 | تصدير/استيراد STIX 2.1 (M) | todo | — |
| P4-015 | GEXF وGraphML وCSV وPROV (M) | todo | — |
| P4-016 | حزمة القضية الموقعة `.irpack` (M) | todo | — |
| P4-017 | الادعاءات المتناقضة وعرضها (S) | todo | — |
| P4-018 | تحليلات رسم إضافية: العقد الحرجة (cut vertices) والجسور، كل المسارات بين عقدتين بحد طول، التجميع حسب النوع أو المصدر أو الفترة (S) | todo | — |
| P4-019 | أنماط زمنية عبر المصادر: فترات النشاط والصمت المفاجئ والتصاعد والتكرار (S) | todo | — |
| P4-020 | ربط نتائج التهديد بـ MITRE ATT&CK وCAPEC وD3FEND ببيانات STIX محلية، وعرض مصفوفة ATT&CK للقضية (S) | todo | — |
| P4-021 | فحص YARA على الملفات المرفوعة، ومطابقة قواعد Sigma على السجلات المستوردة، بقواعد مُنزَّلة محلياً (YARA Forge، SigmaHQ) (S) | todo | — |
| P4-022 | تصدير مؤشرات التهديد: MISP JSON وOpenIOC وقوائم IOC نصية/CSV مع خيار التمويه (defang) (S) | todo | — |
| P4-023 | معيار دمج الكيانات مقابل Splink وZingg وdedupe على المجموعة المرجعية نفسها (S) | todo | — |

### المرحلة 5: العربية وكتب الإجراءات والتقارير والذكاء الاصطناعي

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P5-001 | `@ir/arabic`: تطبيع الأسماء (M) | todo | — |
| P5-002 | التحويل الصوتي عربي↔لاتيني متعدد المخططات (M) | todo | — |
| P5-003 | مطابقة الأسماء العربية في الدمج والبحث (M) | todo | — |
| P5-004 | الهجري وتنسيق التواريخ (M) | todo | — |
| P5-005 | الصيغ المحلية الخليجية (هاتف، IBAN، سجلات) (M) | todo | — |
| P5-006 | مجموعة ذهبية عربية (2,000 زوج اسم) (M) | todo | — |
| P5-007 | محرك كتب الإجراءات (YAML + بوابات) (M) | todo | — |
| P5-008 | الكتب الثمانية الأولى (الملحق C) (M) | todo | — |
| P5-009 | استخراج المعرفة من ملفات بايثون إلى YAML بعد التنقية (S) | todo | — |
| P5-010 | `@ir/reports`: قوالب HTML/PDF/DOCX بإحالات (M) | todo | — |
| P5-011 | مدقق الإحالات في التقارير (M) | todo | — |
| P5-012 | `@ir/ai`: واجهة مزوّد ومحلي افتراضياً (M) | todo | — |
| P5-013 | التلخيص المقيد بالأدلة والتحقق منه (M) | todo | — |
| P5-014 | مقاومة حقن الأوامر (M) | todo | — |
| P5-015 | استخراج الكيانات من الوثائق بالذكاء الاصطناعي (اقتراحات) (S) | todo | — |
| P5-016 | وضع التدريب في المحاكاة (S) | todo | — |
| P5-017 | ترجمة كاملة ومراجعة لغوية للواجهة والوثائق (M) | todo | — |
| P5-018 | اقتراح الخطوة التالية (Next Best Action) وتوليد فرضيات مع تبرير بالأدلة (S) | todo | — |
| P5-019 | السؤال بلغة طبيعية عن القضية، مقيد بالأدلة (S) | todo | — |
| P5-020 | بحث دلالي محلي داخل القضية (تضمينات بنموذج محلي) (C) | todo | — |
| P5-021 | سجل استخدام الذكاء الاصطناعي وتكلفته، ومفتاح تعطيل كامل لكل قضية (M) | todo | — |
| P5-022 | تصدير Markdown وصورة الرسم (PNG/SVG) وتخصيص هوية التقرير (شعار، ألوان، علامة مائية، تصنيف السرية) (S) | todo | — |
| P5-023 | قوالب تقارير إضافية: ملف كيان (Dossier)، تقرير خط زمني، تقرير مقارنة (C) | todo | — |
| P5-024 | التعرف الضوئي على النص (OCR) محلياً للعربية والإنجليزية (S) | todo | — |
| P5-025 | اختيار أدوات العربية للتجزئة والكيانات المسماة: CAMeL Tools وFarasa وStanza وspaCy بقياس على مجموعة عربية، وسجل قرار (S) | todo | — |
| P5-026 | كشف التلاعب في الصور محلياً: ELA، تحليل الضغط، تطابق التجزئة الإدراكية مع صور القضية، ومزوّد اختياري لكشف التزييف العميق (C) | todo | — |
| P5-027 | محرك PDF للتقارير العربية: مقارنة Typst وPlaywright وReact-PDF في RTL والخطوط وروابط الإحالات، وسجل قرار (S) | todo | — |

### المرحلة 6: التقوية والنسخة التجريبية

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P6-001 | مطابقة OWASP ASVS L2 (M) | todo | — |
| P6-002 | نمذجة التهديدات (STRIDE) (M) | todo | — |
| P6-003 | اختبار اختراق خارجي (M) | todo | — |
| P6-004 | Fuzzing للمحلّلات (الكشف، الاستيراد) (S) | todo | — |
| P6-005 | اختبارات الطفرات (Stryker) للنواة (M) | todo | — |
| P6-006 | اختبارات الأداء والحمل (M) | todo | — |
| P6-007 | النسخ الاحتياطي والاستعادة (M) | todo | — |
| P6-008 | الحذف الآمن والاحتفاظ (M) | todo | — |
| P6-009 | الصلاحيات والأدوار لفريق صغير (S) | todo | — |
| P6-010 | تقييم الأثر على الخصوصية (DPIA) (M) | todo | — |
| P6-011 | برنامج Beta (10 سيناريوهات، 15 مستخدماً على الأقل) (M) | todo | — |
| P6-012 | إصلاح نتائج Beta (M) | todo | — |
| P6-013 | تدقيق الوصول WCAG 2.2 AA (M) | todo | — |
| P6-014 | مراجعة التراخيص للاعتماديات والمصادر (M) | todo | — |
| P6-015 | سياسة الخصوصية وشروط الاستخدام وقناة الإبلاغ عن إساءة الاستخدام (M) | todo | — |

### المرحلة 7: الإطلاق والتشغيل

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P7-001 | خط الإصدار: semver، changesets، ملاحظات إصدار (M) | todo | — |
| P7-002 | صور Docker متعددة المعماريات وموقعة (cosign) (M) | todo | — |
| P7-003 | SBOM (CycloneDX) وإثبات المصدر (SLSA) (M) | todo | — |
| P7-004 | تطبيق سطح المكتب (Tauri) (C) | todo | — |
| P7-005 | موقع التوثيق (عربي/إنجليزي) (M) | todo | — |
| P7-006 | كتيبات التشغيل والاستجابة للحوادث (M) | todo | — |
| P7-007 | سياسة الإفصاح عن الثغرات وبرنامج المكافآت (اختياري) (M) | todo | — |
| P7-008 | المراجعة القانونية النهائية (M) | todo | — |
| P7-009 | مراجعة البوابات G-01..G-50 والتوقيع (M) | todo | — |
| P7-010 | الإطلاق GA 1.0 ومتابعة ما بعده (30 يوماً) (M) | todo | — |
| P7-011 | سياسة دعم الإصدارات ومراحل الإطلاق (Alpha داخلي، Beta مغلق، Beta عام، RC، مستقر) (S) | todo | — |

### المرحلة 8: آفاق ما بعد GA

| المعرّف | المهمة | الحالة | الدليل / الإيداع |
|---|---|---|---|
| P8-001 | قرار معماري ADR-24: هل تُبنى خدمة سحابية متعددة المستأجرين (SaaS)؟ ونموذجها التجاري والقانوني (M) | todo | — |
| P8-002 | نظام مستخدمين كامل لنمط الفريق/السحابة: OAuth، مصادقة ثنائية، استعادة كلمة المرور، إدارة الجلسات (S) | todo | — |
| P8-003 | المنظمات والأدوار والصلاحيات الدقيقة: منظمة (مالك، مدير، عضو، فوترة) وقضية (مالك، محرر، معلّق، مشاهد) وصلاحيات المصدر والتصدير والدعوة والحذف (S) | todo | — |
| P8-004 | التعاون اللحظي: مزامنة بـ CRDT، حضور ومؤشرات، سجل نشاط حي (S) | todo | — |
| P8-005 | التعليقات والمهام داخل القضية والإشعارات (داخل التطبيق، بريد، Webhook) (S) | todo | — |
| P8-006 | مشاركة بروابط آمنة منتهية الصلاحية، قراءة فقط أو تحرير، ومشاركة جزئية لعقد محددة (C) | todo | — |
| P8-007 | الاشتراكات والفوترة والحصص (مثلاً Stripe أو Paddle): خطط مجاني/محترف/فريق/مؤسسات وحدود التحقيقات والعقد والتخزين والأعضاء (C) | todo | — |
| P8-008 | لوحة الإدارة: المستخدمون، الاستخدام، الخطط، الدعم (C) | todo | — |
| P8-009 | نشر سحابي متعدد البيئات (تطوير، تجهيز، إنتاج)، Helm/Kubernetes، نسخ احتياطي تلقائي وخطة تعافٍ من الكوارث (C) | todo | — |
| P8-010 | منصة الإضافات العامة: SDK، قالب رسمي، أداة إنشاء من سطر الأوامر، توقيع، وأنواع غير المحوّلات (عارضات عقد، مصدّرات، محللات، سمات) (S) | todo | — |
| P8-011 | سوق الإضافات: تصفح، تقييم، مراجعة أمنية قبل النشر (C) | todo | — |
| P8-012 | تكاملات أمنية: MISP، TheHive/Cortex، OpenCTI، Splunk، Elastic (S) | todo | — |
| P8-013 | تكاملات إنتاجية: Slack، Microsoft Teams، Discord، Jira، وجدولة التقارير وإرسالها (C) | todo | — |
| P8-014 | تكاملات بيانات: Maltego (استيراد/تصدير)، Neo4j وقواعد رسم أخرى (C) | todo | — |
| P8-015 | واجهة برمجية عامة مستقرة: SDK بـ JavaScript وPython، Webhooks عامة، وGraphQL اختياري (S) | todo | — |
| P8-016 | ملفات إضافية: PCAP، الأرشيفات بفك آمن (حماية من قنابل الضغط)، تفريغ صوتي محلي (C) | todo | — |
| P8-017 | تحليلات متقدمة: مصفوفة ومخطط أقواس، أنماط زمنية، كشف الشذوذ (C) | todo | — |
| P8-018 | قياس استخدام اختياري (opt-in) ذاتي الاستضافة ومؤشرات المنتج (C) | todo | — |
| P8-019 | المحتوى التعليمي والمجتمع: دروس قصيرة، دراسات حالة، منتدى، برنامج سفراء (C) | todo | — |
| P8-020 | الحضور الخارجي والشراكات: موقع تعريفي، مؤتمرات، شراكات أكاديمية وأمنية (C) | todo | — |
| P8-021 | امتثال SOC 2 ثم ISO 27001 (عند وجود خدمة سحابية) (C) | todo | — |
| P8-022 | بحث طويل المدى: لهجات ولغات نادرة، أدوات قطاعية (صحافة، قانون)، الهوية اللامركزية (C) | todo | — |
| P8-023 | خادم MCP يعرض محوّلات المنصة وقضاياها لأدوات الذكاء الاصطناعي بالصلاحيات نفسها (S) | todo | — |
| P8-024 | استيراد نتائج SpiderFoot وtheHarvester وAmass (JSON/CSV) كأدلة بمصدرها (S) | todo | — |

## البوابات

| المعرّف | الركيزة | البوابة | المرحلة | الحالة |
|---|---|---|---|---|
| G-01 | P8 | `typecheck` أخضر في الجذر | 0 | متحققة (PR #2) |
| G-02 | P8 | `build` أخضر لكل التطبيقات | 0 | متحققة (PR #3) |
| G-03 | P8 | `test` أخضر في CI | 0 | متحققة (PR #3: `test` أخضر ومطلوب) |
| G-04 | P9 | README وLICENSE وSECURITY وCONTRIBUTING موجودة | 0 | متحققة (P0-008) |
| G-05 | P9 | حارس الحوكمة مفعل محلياً وفي CI، و`main` محمي | 0 | متحققة |
| G-06 | P9 | كل مهمة في الخارطة لها سطر حالة | 0 | متحققة (`--consistency`) |
| G-07 | P4 | لا أسرار في المستودع (gitleaks) | 0 | متحققة (P0-017: gitleaks على كامل التاريخ نظيف) |
| G-08 | P2 | 100% من الأمثلة الإيجابية تطابق نوعها | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). P1-027: 377/377 مثالاً إيجابياً لـ 371 نوعاً = 100%؛ فحص اتساق ذاتي للكتالوج |
| G-09 | P2 | دقة الكشف الحتمي ≥ 99% | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). P1-027: golden اصطناعي داخلي 5,000 مقتطف (6 قوالب عربية و5 إنجليزية، 23 عائلة)، الدقة والاستدعاء 99.97%. لا تُعد دقة واقعية ولا يُعلن عنها قبل التقييم المستقل (D-4) |
| G-10 | P3 | T-LED كلها خضراء | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). لنطاق المرحلة 1 فقط (T-LED-001..019 مغطاة وخضراء، قبول المالك D-7)؛ T-LED-020 (الإعادة بلا شبكة) غير منجزة ومرتبطة بـ P2-018 |
| G-11 | P4 | المفاتيح لا تغادر الخادم | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). P1-027: اختبارات الوحدة، وخادم مبني بلا تسرب للمفتاح، وفحص نصي للحزمة، وفحص شبكة فعلي في Chrome: كل طلبات الواجهة إلى أصل الخادم (D-053). المفتاح افتراضياً بجانب الخزنة (R-12) |
| G-12 | P5 | لا قضية بلا غرض | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). P1-028: 9 اختبارات منها 4 لـ D-052؛ لا node:sqlite خارج packages/store ولا DatabaseSync خارج case.ts. الانقطاع داخل العملية فقط؛ قتل العملية فعلياً لم يُختبر |
| G-13 | P8 | تغطية النواة ≥ 85% | 1 | متحققة على `main` (`bf114ec`، خمسة تشغيلات `gates` متتالية خضراء، تشغيل 38077329839 المحاولات 1–5). core 99.27% وledger 98.82% أسطراً؛ مفروضة في `main` عبر الفحص المطلوب `test`؛ engine وegress لم تُنشآ |
| G-14 | P4 | SSRF suite خضراء | 2 | لم تتحقق |
| G-15 | P4 | T-SBX خضراء | 2 | لم تتحقق |
| G-16 | P1 | 40 محوّلاً على الأقل منفذة ومعتمدة | 2 | لم تتحقق |
| G-17 | P3 | الإعادة بلا شبكة حتمية | 2 | لم تتحقق |
| G-18 | P5 | بوابة الأشخاص الطبيعيين مفروضة | 2 | لم تتحقق |
| G-19 | P1 | T-COV خضراء | 2 | لم تتحقق |
| G-20 | P1 | كل مكونات 2.5.1 موجودة وتعمل | 3 | لم تتحقق |
| G-21 | P6 | NFR-01 وNFR-02 متحققان | 3 | لم تتحقق |
| G-22 | P7 | صفر نص مضمن، ولقطات RTL معتمدة | 3 | لم تتحقق |
| G-23 | P7 | axe بلا حرج | 3 | لم تتحقق |
| G-24 | P8 | E2E لـ UC-01..UC-06 خضراء | 3 | لم تتحقق |
| G-25 | P2 | T-CONF خضراء | 4 | لم تتحقق |
| G-26 | P2 | F1 الدمج ≥ 0.9 | 4 | لم تتحقق |
| G-27 | P3 | التراجع عن الدمج بلا فقد | 4 | لم تتحقق |
| G-28 | P2 | T-TIME خضراء | 4 | لم تتحقق |
| G-29 | P1 | T-IO خضراء | 4 | لم تتحقق |
| G-30 | P2 | T-AR: recall ≥ 0.95 | 5 | لم تتحقق |
| G-31 | P1 | 8 كتب إجراءات مكتملة | 5 | لم تتحقق |
| G-32 | P1 | كل جملة تقرير محالة | 5 | لم تتحقق |
| G-33 | P2 | ذكاء اصطناعي ≤ 2% غير مدعوم | 5 | لم تتحقق |
| G-34 | P4 | 0 تنفيذ في مجموعة الحقن | 5 | لم تتحقق |
| G-35 | P7 | مراجعة لغوية عربية معتمدة | 5 | لم تتحقق |
| G-36 | P4 | ASVS L2 مكتمل | 6 | لم تتحقق |
| G-37 | P4 | اختبار اختراق بلا حرج/عالٍ مفتوح | 6 | لم تتحقق |
| G-38 | P8 | mutation score ≥ 60% | 6 | لم تتحقق |
| G-39 | P6 | كل سقوف القسم 9 متحققة | 6 | لم تتحقق |
| G-40 | P9 | استعادة آلية ناجحة | 6 | لم تتحقق |
| G-41 | P5 | الحذف الآمن مختبر | 6 | لم تتحقق |
| G-42 | P5 | DPIA معتمد | 6 | لم تتحقق |
| G-43 | P10 | Beta: ≥ 90% نجاح | 6 | لم تتحقق |
| G-44 | P10 | Beta: SUS ≥ 75 | 6 | لم تتحقق |
| G-45 | P7 | WCAG 2.2 AA مدقق | 6 | لم تتحقق |
| G-46 | P9 | صور موقعة وSBOM | 7 | لم تتحقق |
| G-47 | P5 | مراجعة قانونية معتمدة | 7 | لم تتحقق |
| G-48 | P9 | موقع التوثيق مكتمل | 7 | لم تتحقق |
| G-49 | P9 | كتيبات التشغيل وتمرين واحد | 7 | لم تتحقق |
| G-50 | الكل | كل ما سبق أخضر وتوقيع المالك | 7 | لم تتحقق |

## العيوب (خط الأساس D-001..D-050، وما اكتُشف بعده)

| المعرّف | الشدة | الحالة | ملاحظة |
|---|---|---|---|
| D-001 | حاجز | مُصلح | P0-004 |
| D-002 | حاجز | مُصلح جزئياً | P0-006 نقطة دخول دنيا؛ محطة العمل في P3-002 |
| D-003 | حاجز | مفتوح | — |
| D-004 | حرج | مُصلح | P0-005 |
| D-005 | عالٍ | مغلق | P1-020: على 5,000 مقتطف ذهبي: الحتمي precision 99.97% وrecall 99.97% (6,531 من 6,533)، ولا شبيه معطوب مقبول؛ أول تطابق كان 14.1% |
| D-006 | عالٍ | مغلق | P1-004: الأمثلة الإيجابية مقبولة 100% بنمط نوعها ومدققه (377 من 377 بالقياس) |
| D-007 | عالٍ | مغلق | P1-006: الأنواع المتطابقة النمط مرشحون منفصلون بدرجات متساوية، والسياق يحسم بينها |
| D-008 | متوسط | مغلق | P1-003: العدد الحقيقي 371 نوعاً في 13 تصنيفاً مقاس وموثّق، والتوسعة عبر YAML بمثال إيجابي وسلبي إلزامي |
| D-009 | عالٍ | مغلق | P1-004: wickr_id بطول 5..20 ولا يُقترح إلا بكلمة سياق (context.required) |
| D-010 | متوسط | مغلق | P1-003: تصنيف Messaging مستقل للأنواع الخمسة |
| D-011 | عالٍ | مغلق | P1-008: 52 نوعاً موسومة natural_person_gate؛ الفرض في المحرك مع P2-013 |
| D-012 | عالٍ | مفتوح | — |
| D-013 | عالٍ | مُصلح | P0-022 |
| D-014 | متوسط | مفتوح | — |
| D-015 | عالٍ | مفتوح | — |
| D-016 | عالٍ | مفتوح | — |
| D-017 | عالٍ | مفتوح | — |
| D-018 | متوسط | مفتوح | — |
| D-019 | عالٍ | مفتوح | — |
| D-020 | عالٍ | مُصلح | P1-007: visited/nodeId on canonicalKey (smartInvestigator.ts) |
| D-021 | عالٍ | مُصلح | P1-007: makeNodeId = canonicalKey, no truncation/substitution |
| D-022 | متوسط | مفتوح | — |
| D-023 | عالٍ | مفتوح | — |
| D-024 | متوسط | مفتوح | — |
| D-025 | عالٍ | مُصلح | P1-002: Claim.predicate typed edge (packages/schema/src/graph.ts) |
| D-026 | منخفض | مفتوح | — |
| D-027 | منخفض | مغلق | P1-006: كاشف واحد detect/detectBest في الواجهة بدل detectType وdetectIdentifier |
| D-028 | متوسط | مفتوح | — |
| D-029 | متوسط | مفتوح جزئياً | P1-005: الأنواع الأربعة تمر بمدقق EVM صريح (EIP-55) بدل معاملتها كإيثيريوم؛ التمييز بين السلاسل يحتاج استعلام السلسلة (P2-010) |
| D-030 | حرج | مغلق | P1-015: المفاتيح في خزنة الخادم المختومة، والواجهة لا تخزنها ولا تستلمها؛ نقل تلقائي لمرة واحدة من localStorage ثم حذفها |
| D-031 | متوسط | مفتوح | — |
| D-032 | منخفض | مفتوح | — |
| D-033 | عالٍ | مغلق | P1-021: لا persist ولا كتابة في localStorage/sessionStorage؛ المفتاح القديم يُحذف عند الإقلاع؛ اختبار حارس يمنع العودة |
| D-034 | متوسط | مُصلح | P1-021 + P1-022: lookups by id index; bulk adds via addNodes/addEdges (one copy per batch) |
| D-035 | عالٍ | مفتوح جزئياً | P1-013 + P1-014: تخزين الخادم بترحيلات ومعاملات وتشفير جاهز؛ الواجهة ما زالت على Dexie (investigationDatabase.ts) حتى تنتقل إلى واجهة القضية البرمجية في المرحلة 3 |
| D-036 | متوسط | مفتوح جزئياً | P1-010: الاستجابة الخام تُحفظ blob متحققاً منه ومصدرها (الطلب المنقّح) في `evidence.stored`؛ يبقى استبدال الكاش الثابت بالساعة (P2-007) |
| D-037 | عالٍ | مُصلح جزئياً | P1-026: CORS مغلق، ورمز إدارة إلزامي، وحد معدل، وحد 8kb للجسم؛ باقٍ ترويسات الأمان (helmet) مع P2-019 وP2-020 وP6-001 |
| D-038 | متوسط | مُصلح جزئياً | P0-014؛ القرار النهائي في ADR-04 |
| D-039 | متوسط | مُصلح | P0-007 |
| D-040 | عالٍ | مُصلح | P0-008، P0-009، P0-010، P0-011 |
| D-041 | منخفض | مُصلح | P0-012 |
| D-042 | متوسط | مُصلح | P0-016 |
| D-043 | منخفض | مفتوح | — |
| D-044 | منخفض | مُصلح (بعد تصحيح الوصف) | P0-013 |
| D-045 | متوسط | مُصلح | P0-015 (ADR-01) |
| D-046 | منخفض | مفتوح | — |
| D-047 | متوسط | مُصلح جزئياً | P0-012: `lang/dir`؛ i18n في P3-017 |
| D-048 | متوسط | جزئي | كتالوج الأدوات يوثق المصادر وحالتها؛ التوثيق لكل محوّل في P2-011 |
| D-049 | عالٍ | مفتوح (مخفف) | P1-030: `/api/lookup/*` معطلة افتراضياً؛ السياسة (غرض وموافقة) مع P2-013 |
| D-050 | متوسط | مفتوح جزئياً | P1-017 + P1-018: سجل التدقيق وغرض القضية منفّذان؛ تمييز الأشخاص الطبيعيين يأتي مع P2-013 |
| D-051 | عالٍ | مُصلح | P1-022: incremental merge index, invalidated on revert or late alias; D-051 tests fail on the old code |
| D-052 | عالٍ | مُصلح (العيب)؛ مهلة الاختبار: لم يُعَد إنتاجها | P1-028: meta + case.created + audit in one transaction; IncompleteCaseError; `ir verify` checks purpose; 4 D-052 tests fail on the old code. **مهلة الاختبار في CI (6366–6672 ms مقابل 5000 ms، 2026-10-11):** لم يُعَد إنتاجها في التجربة المضبوطة (PR #67، run 38241375021: 6 تشغيلات ناجحة، مدة الاختبار 301–462 ms). السبب **غير مثبت**؛ لا يُدّعى أنه بيئي. لا تغيير في KDF أو Argon2id ولا رفع لمهلة 5000 ms ولا تقسيم للاختبار. إن تكرر الفشل تُجمع سجلات ذلك التشغيل قبل أي قرار |
| D-053 | متوسط | مُصلح | P1-027 (PR #38): مهلة صريحة 30 ث ورسالة فشل؛ خمسة تشغيلات `gates` متتالية خضراء على `main` عند `bf114ec`؛ أبطأ اختبار 7,984 ms، واختبار الـ 600 حدث بلغ 4,953 ms |
| D-054 | عالٍ | مُصلح (فرز كامل) | P1-029 (PR #39): بعد الدمج 4 تنبيهات مفتوحة فقط، كلها في السجل؛ كل تنبيه حرج وعالٍ له قرار ودليل؛ 11 مُصلحة، و#54 (`braces`) استثناء حتى 2026-10-17؛ و3 متوسطة أو منخفضة مؤجلة بسبب موثق |
| D-055 | عالٍ | مُصلح في PR #68 (غير مدمج) | `lib/api-client-react/src/custom-fetch.ts` على `main` يمرر إلى `fetch` روابط تخرج عن الأصل نفسه: `//evil.example/x` و`/\evil.example/x` و`/<TAB>/evil.example/x` وأشكال مشابهة (17 اختباراً تفشل على نسخة `main`). الإصلاح يقرر الأصل بمحلل WHATWG، ويرفض قبل استدعاء `fetch` مع قاعدة أو بدونها؛ `custom-fetch.test.ts` |











