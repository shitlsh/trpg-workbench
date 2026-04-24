use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn get_system_memory_gb() -> u64 {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    let bytes = sys.total_memory();
    bytes / (1024 * 1024 * 1024)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_system_memory_gb])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Spawn Python backend ────────────────────────────────────────
            let shell = app.shell();
            let _resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            // In dev, run from backend directory directly
            #[cfg(debug_assertions)]
            {
                let backend_dir = std::env::current_dir()
                    .unwrap()
                    .parent() // apps/
                    .unwrap()
                    .join("backend");

                let venv_python = backend_dir.join(".venv/bin/python3");
                let server_script = backend_dir.join("server.py");

                if venv_python.exists() && server_script.exists() {
                    let _ = shell
                        .command(venv_python.to_str().unwrap())
                        .args([server_script.to_str().unwrap()])
                        .env("PIP_USER", "false")
                        .spawn();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
