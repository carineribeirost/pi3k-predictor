use serde::Serialize;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::error::AppError;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub log_dir: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    let log_dir = app.path().app_log_dir().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        log_dir: log_dir.display().to_string(),
    })
}
