mod commands;
mod error;
mod export;
mod science;
mod store;

use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind};

use commands::ModelState;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ModelState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            log::info!("PI3K Predictor v{} started", app.package_info().version);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = store::open(&data_dir.join("pi3k.sqlite"))?;
            app.manage::<store::Db>(Mutex::new(conn));

            // Decompressing and checking the model takes a moment; keep the window responsive.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let start = std::time::Instant::now();
                let loaded = handle
                    .path()
                    .resolve("resources", BaseDirectory::Resource)
                    .map_err(|e| e.to_string())
                    .and_then(|dir| science::ModelStore::load(&dir));
                match &loaded {
                    Ok(m) => log::info!("model {} loaded in {:?}", m.reference.model_version, start.elapsed()),
                    Err(e) => log::error!("model failed to load: {e}"),
                }
                let _ = handle.state::<ModelState>().0.set(loaded);
                if let Err(e) = handle.emit("model-status-changed", commands::model_status_of(&handle)) {
                    log::warn!("could not emit model status: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::model_status,
            commands::reference_data,
            commands::create_run,
            commands::predict_chunk,
            commands::predict_one,
            commands::list_runs,
            commands::get_run,
            commands::get_run_rows,
            commands::rename_run,
            commands::set_run_threshold,
            commands::delete_run,
            commands::export_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
