mod commands;
mod error;

use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir { file_name: None }),
            Target::new(TargetKind::Webview),
        ])
        .level(log::LevelFilter::Info)
        .level_for(
            "pi3k_predictor_lib",
            if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info },
        )
        .build();

    tauri::Builder::default()
        .plugin(log)
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            log::info!("PI3K Predictor v{} started", app.package_info().version);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
