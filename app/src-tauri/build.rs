fn main() {
    // Every app command must be listed here; it generates allow-/deny- permissions for capabilities.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["app_info"])),
    )
    .expect("failed to run tauri-build");
}
