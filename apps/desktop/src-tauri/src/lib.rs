use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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

/// Returns the log directory: <app_data>/trpg-workbench/logs/
/// Falls back to a temp dir if the app data path is unavailable.
fn get_log_dir(app: &tauri::App) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("trpg-workbench").join("logs"))
}

/// Write a line to the backend log file, prefixed with timestamp.
fn write_log(log_file: &Arc<Mutex<fs::File>>, line: &str) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("[{now}] {line}\n");
    if let Ok(mut f) = log_file.lock() {
        let _ = f.write_all(entry.as_bytes());
    }
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
            // ── Set up log file ─────────────────────────────────────────────
            let log_dir = get_log_dir(app);
            let _ = fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("backend.log");
            let log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .expect("Failed to open backend log file");
            let log_file = Arc::new(Mutex::new(log_file));

            write_log(&log_file, &format!("=== trpg-workbench started, log: {} ===", log_path.display()));
            write_log(&log_file, &format!("Backend port: {port}"));

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Spawn Python backend ────────────────────────────────────────
            let shell = app.shell();
            let port_str = port.to_string();

            // In dev, run from backend venv directly (no log capture needed)
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

            // In release, use the bundled sidecar and capture its output
            #[cfg(not(debug_assertions))]
            {
                let log_file_clone = Arc::clone(&log_file);
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
                                write_log(&log_file_clone, &format!("[stdout] {text}"));
                            }
                            CommandEvent::Stderr(line) => {
                                let text = String::from_utf8_lossy(&line);
                                write_log(&log_file_clone, &format!("[stderr] {text}"));
                            }
                            CommandEvent::Error(err) => {
                                write_log(&log_file_clone, &format!("[error] {err}"));
                            }
                            CommandEvent::Terminated(status) => {
                                write_log(
                                    &log_file_clone,
                                    &format!(
                                        "[terminated] code={:?} signal={:?}",
                                        status.code, status.signal
                                    ),
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
