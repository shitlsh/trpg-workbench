use tauri::Manager;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri::menu::{Menu, MenuItem, Submenu};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Help menu ───────────────────────────────────────────────────
            let getting_started = MenuItem::with_id(
                app,
                "help_getting_started",
                "Getting Started",
                true,
                None::<&str>,
            )?;
            let model_setup = MenuItem::with_id(
                app,
                "help_model_setup",
                "Model Setup",
                true,
                None::<&str>,
            )?;
            let knowledge_import = MenuItem::with_id(
                app,
                "help_knowledge_import",
                "Knowledge Import",
                true,
                None::<&str>,
            )?;
            let start_creating = MenuItem::with_id(
                app,
                "help_start_creating",
                "Start Creating",
                true,
                None::<&str>,
            )?;
            let help_submenu = Submenu::with_items(
                app,
                "Help",
                true,
                &[
                    &getting_started,
                    &model_setup,
                    &knowledge_import,
                    &start_creating,
                ],
            )?;
            let menu = Menu::with_items(app, &[&help_submenu])?;
            app.set_menu(menu)?;

            // ── Menu event handler ──────────────────────────────────────────
            app.on_menu_event(|app, event| {
                let doc = match event.id().as_ref() {
                    "help_getting_started" => Some("getting-started"),
                    "help_model_setup"     => Some("model-setup"),
                    "help_knowledge_import"=> Some("knowledge-import"),
                    "help_start_creating"  => Some("start-creating"),
                    _ => None,
                };
                if let Some(doc) = doc {
                    let _ = app.emit("open_help", doc);
                }
            });

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
