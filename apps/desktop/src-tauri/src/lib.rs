use std::net::TcpListener;
use tauri::Manager;
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;

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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                // Suppress noisy crates
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("tracing", log::LevelFilter::Warn)
                .build(),
        )
        .manage(BackendPort(port))
        .invoke_handler(tauri::generate_handler![get_system_memory_gb, get_backend_port])
        .setup(move |app| {
            // Log file location for user reference (tauri-plugin-log handles the file):
            // Windows: %APPDATA%\trpg-workbench\logs\trpg-workbench.log
            // macOS:   ~/Library/Logs/trpg-workbench/trpg-workbench.log
            if let Ok(log_dir) = app.path().app_log_dir() {
                log::info!("App log dir: {}", log_dir.display());
            }
            log::info!("Backend port: {port}");

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Spawn Python backend ────────────────────────────────────────
            let shell = app.shell();
            let port_str = port.to_string();

            // In dev, run from backend venv directly (stdout visible in terminal)
            #[cfg(debug_assertions)]
            {
                let backend_dir = std::env::current_dir()
                    .unwrap()
                    .parent() // apps/desktop/
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

            // In release, use the bundled sidecar and pipe output into the log system
            #[cfg(not(debug_assertions))]
            {
                let (mut rx, _child) = shell
                    .sidecar("trpg-backend")
                    .expect("Failed to create sidecar command")
                    .args(["--port", &port_str])
                    .spawn()
                    .expect("Failed to spawn trpg-backend sidecar");

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let text = String::from_utf8_lossy(&line);
                                log::info!("[backend] {}", text.trim_end());
                            }
                            CommandEvent::Stderr(line) => {
                                let text = String::from_utf8_lossy(&line);
                                log::error!("[backend] {}", text.trim_end());
                            }
                            CommandEvent::Error(err) => {
                                log::error!("[backend:error] {err}");
                            }
                            CommandEvent::Terminated(status) => {
                                log::warn!(
                                    "[backend:terminated] code={:?} signal={:?}",
                                    status.code,
                                    status.signal
                                );
                            }
                            _ => {}
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
