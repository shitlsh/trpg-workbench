use std::net::TcpListener;
use tauri::Manager;
use tauri::State;
use tauri_plugin_shell::ShellExt;

struct BackendPort(u16);

/// Allocate a random available port by binding to port 0.
fn get_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port")
        .local_addr()
        .unwrap()
        .port()
}

#[tauri::command]
fn get_system_memory_gb() -> u64 {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    let bytes = sys.total_memory();
    bytes / (1024 * 1024 * 1024)
}

#[tauri::command]
fn get_backend_port(state: State<BackendPort>) -> u16 {
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = get_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendPort(port))
        .invoke_handler(tauri::generate_handler![get_system_memory_gb, get_backend_port])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Spawn Python backend ────────────────────────────────────────
            let shell = app.shell();
            let port_str = port.to_string();

            // In dev, run from backend venv directly
            #[cfg(debug_assertions)]
            {
                let backend_dir = std::env::current_dir()
                    .unwrap()
                    .parent() // apps/
                    .unwrap()
                    .join("backend");

                #[cfg(target_os = "windows")]
                let venv_python = backend_dir.join(".venv/Scripts/python.exe");
                #[cfg(not(target_os = "windows"))]
                let venv_python = backend_dir.join(".venv/bin/python3");

                let server_script = backend_dir.join("server.py");

                if venv_python.exists() && server_script.exists() {
                    let _ = shell
                        .command(venv_python.to_str().unwrap())
                        .args([server_script.to_str().unwrap(), "--port", &port_str])
                        .env("PIP_USER", "false")
                        .spawn();
                }
            }

            // In release, use the bundled sidecar
            #[cfg(not(debug_assertions))]
            {
                let _ = shell
                    .sidecar("trpg-backend")
                    .expect("Failed to create sidecar command")
                    .args(["--port", &port_str])
                    .spawn();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
