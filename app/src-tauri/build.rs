fn main() {
    // Every app command must be listed here; it generates allow-/deny- permissions for capabilities.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "app_info",
                "model_status",
                "reference_data",
                "create_run",
                "predict_chunk",
                "predict_one",
                "list_runs",
                "get_run",
                "get_run_rows",
                "rename_run",
                "set_run_threshold",
                "delete_run",
            ])),
    )
    .expect("failed to run tauri-build");
}
