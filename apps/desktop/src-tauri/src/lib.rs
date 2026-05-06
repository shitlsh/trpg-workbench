use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

struct BackendPort(u16);

#[cfg(not(debug_assertions))]
struct BackendChild(Mutex<Option<CommandChild>>);

/// Allocate a random available port by binding to port 0.
fn get_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port")
        .local_addr()
        .unwrap()
        .port()
}

/// Mirror Python's get_data_dir(): $TRPG_DATA_DIR or ~/trpg-workbench-data
fn get_data_dir() -> PathBuf {
    if let Ok(val) = std::env::var("TRPG_DATA_DIR") {
        PathBuf::from(val)
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("trpg-workbench-data")
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

    // Resolve log dir early so it can be passed into tauri-plugin-log builder.
    // Both Python backend.log and Rust/frontend app.log end up in the same dir:
    //   ~/trpg-workbench-data/logs/
    let log_dir = get_data_dir().join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: log_dir.clone(),
                        file_name: Some("app".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                // Suppress noisy crates
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("tracing", log::LevelFilter::Warn)
                .build(),
        )
        .manage(BackendPort(port));

    #[cfg(not(debug_assertions))]
    {
        builder = builder.manage(BackendChild(Mutex::new(None)));
    }

    builder
        .invoke_handler(tauri::generate_handler![get_system_memory_gb, get_backend_port])
        .setup(move |app| {
            log::info!("=== trpg-workbench started ===");
            log::info!("Log dir: {}", log_dir.display());
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
                let (mut rx, child) = shell
                    .sidecar("trpg-backend")
                    .expect("Failed to create sidecar command")
                    .args(["--port", &port_str])
                    .spawn()
                    .expect("Failed to spawn trpg-backend sidecar");

                // Store child handle in managed state so it can be killed on exit
                let backend_child = app.state::<BackendChild>();
                *backend_child.0.lock().unwrap() = Some(child);

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
        .on_window_event(|window, event| {
            #[cfg(not(debug_assertions))]
            if let tauri::WindowEvent::Destroyed = event {
                // Kill the backend sidecar when the main window is destroyed
                let app = window.app_handle();
                let backend_child = app.state::<BackendChild>();
                if let Some(mut child) = backend_child.0.lock().unwrap().take() {
                    let _ = child.kill();
                    log::info!("[backend] sidecar killed on window destroy");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
