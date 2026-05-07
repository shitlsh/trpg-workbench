use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;

use tauri_plugin_shell::process::CommandChild;

struct BackendPort(u16);

// Held in managed state for both debug and release builds so that
// on_window_event can unconditionally reference it without cfg guards.
// In debug mode it is always None (dev backend is spawned separately).
struct BackendChild(Mutex<Option<CommandChild>>);

/// Bind to port 0 and return both the chosen port AND the live listener.
/// Keep the listener alive until the sidecar has bound to the port; this
/// prevents another process from stealing the port between our query and
/// the sidecar's bind (TOCTOU race).
fn reserve_port() -> (u16, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port");
    let port = listener.local_addr().unwrap().port();
    (port, listener)
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
    log::info!("[invoke] get_backend_port called, returning port {}", state.0);
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (port, port_listener) = reserve_port();

    // Resolve log dir early so it can be passed into tauri-plugin-log builder.
    // Both Python backend.log and Rust/frontend app.log end up in the same dir:
    //   ~/trpg-workbench-data/logs/
    let log_dir = get_data_dir().join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    tauri::Builder::default()
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
        .manage(BackendPort(port))
        .manage(BackendChild(Mutex::new(None)))
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

            // In dev, run from backend venv directly (stdout visible in terminal).
            // Drop the reserved listener first so the dev backend can bind to the port.
            #[cfg(debug_assertions)]
            {
                drop(port_listener);

                // Use CARGO_MANIFEST_DIR (compile-time) for a stable source-relative path.
                // CARGO_MANIFEST_DIR points to apps/desktop/src-tauri/
                let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
                let backend_dir = manifest_dir
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

            // In release, use the bundled sidecar and pipe output into the log system.
            // Drop the reserved listener just before spawning so the sidecar can bind.
            #[cfg(not(debug_assertions))]
            {
                drop(port_listener);

                let spawn_result = shell
                    .sidecar("trpg-backend")
                    .expect("Failed to create sidecar command")
                    .args(["--port", &port_str])
                    .spawn();

                match spawn_result {
                    Err(e) => {
                        log::error!("Failed to spawn trpg-backend sidecar: {e}");
                        tauri_plugin_dialog::DialogExt::dialog(app)
                            .message(format!(
                                "后端服务启动失败，应用无法运行。\n\n错误信息：{e}\n\n请重新安装应用。"
                            ))
                            .title("启动失败")
                            .blocking_show();
                        std::process::exit(1);
                    }
                    Ok((mut rx, child)) => {
                        // Store child handle in managed state so it can be killed on exit.
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
                                        // uvicorn writes all its logs (INFO/WARNING/ERROR) to stderr.
                                        // Log at info level here to avoid false ERROR noise in app.log.
                                        // Genuine Python exceptions will still appear but without
                                        // alarming log levels for normal uvicorn output.
                                        let text = String::from_utf8_lossy(&line);
                                        log::info!("[backend] {}", text.trim_end());
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
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only kill the sidecar when the *main* window is destroyed.
            // Guarded by window label to prevent a future secondary window
            // (e.g. settings dialog) from prematurely killing the backend.
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    let app = window.app_handle();
                    let backend_child = app.state::<BackendChild>();
                    if let Some(child) = backend_child.0.lock().unwrap().take() {
                        let _ = child.kill();
                        log::info!("[backend] sidecar killed on window destroy");
                        // On Windows, child.kill() may not reliably terminate the
                        // Python backend process. Use taskkill as a follow-up guarantee.
                        #[cfg(target_os = "windows")]
                        {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            let _ = std::process::Command::new("taskkill")
                                .args(["/F", "/IM", "trpg-backend.exe"])
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null())
                                .spawn();
                            log::info!(
                                "[backend] taskkill fallback executed for trpg-backend.exe"
                            );
                        }
                    };
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
