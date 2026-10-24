import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("T-DESK-001: هيكل تطبيق سطح المكتب Tauri موجود ومترابط", () => {
  for (const p of [
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/lib.rs",
    "apps/desktop/src-tauri/build.rs",
  ]) {
    assert.ok(existsSync(p), `${p} مفقود`);
  }
});

test("T-DESK-002: إعدادات Tauri تشير إلى تطبيق الويب وتعرّف هوية المنتج", () => {
  const conf = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
  assert.equal(conf.build.frontendDist, "../web/dist", "frontendDist لا يشير إلى بناء الويب");
  assert.ok(conf.build.devUrl.includes("5173"), "devUrl لا يشير إلى خادم التطوير");
  assert.ok(conf.productName && conf.productName.trim(), "productName فارغ");
  assert.ok(conf.identifier && conf.identifier.includes("investigation"), "identifier غير معرف");
  assert.deepEqual(Object.keys(conf.build), ["beforeBuildCommand", "devUrl", "frontendDist"], "مفاتيح build غير متوقعة");
});

test("T-DESK-003: كود Rust يتبع نمط Tauri 2 الرسمي بنافذة واحدة", () => {
  const main = readFileSync("apps/desktop/src-tauri/src/main.rs", "utf8");
  assert.ok(main.includes("fn main()"), "main.rs بلا دالة رئيسية");
  const lib = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
  assert.ok(lib.includes("generate_context!"), "generate_context! مفقود");
  assert.ok(lib.includes("run()"), "run() مفقود");
  assert.ok(!lib.includes("localhost"), "لا يجوز تضمين عناوين في الكود");
  const cargo = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
  assert.ok(cargo.includes('tauri = { version = "2'), "اعتماد tauri 2 مفقود");
});

test("T-DESK-004: فجوة القبول (التثبيت على 3 أنظمة) معلنة في حدود المشروع", () => {
  const dl = readFileSync("docs/DECLARED_LIMITS.md", "utf8");
  assert.ok(dl.includes("P7-004"), "P7-004 غير موثق في الحدود المعلنة");
  assert.ok(/3 أنظمة|ثلاثة أنظمة/.test(dl), "فجوة الأنظمة الثلاثة غير معلنة");
});
