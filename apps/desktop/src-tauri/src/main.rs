// P7-004 — نقطة دخول تطبيق سطح المكتب (نمط Tauri 2 الرسمي).
// يستدعي run() من lib.rs ليبقي المنطق قابلاً للاختبار خارج الثنائي.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ir_desktop::run()
}
