// P7-004 — قشرة سطح المكتب: نافذة واحدة تعرض واجهة الويب.
// لا شبكة خارجية هنا — الواجهة تتصل بخادم المستخدم المحلي كما في المتصفح.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("failed to run the desktop shell");
}
