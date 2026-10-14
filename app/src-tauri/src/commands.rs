use std::sync::OnceLock;

use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::error::AppError;
use crate::export::{self, ExportResult};
use crate::science::{ModelStore, Prediction, ReferenceData};
use crate::store::{self, Db, MolIn, MolRow, RunSummary};

/// Filled once by the background loader started in `setup`.
#[derive(Default)]
pub struct ModelState(pub OnceLock<Result<ModelStore, String>>);

const MAX_CHUNK: usize = 5_000;
const INPUT_KINDS: [&str; 4] = ["paste", "file", "sketch", "example"];

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub log_dir: String,
}

#[derive(Clone, Serialize, TS)]
#[serde(tag = "state", content = "error", rename_all = "camelCase")]
#[ts(export)]
pub enum ModelStatus {
    Loading,
    Ready,
    Failed(String),
}

pub fn model_status_of(app: &AppHandle) -> ModelStatus {
    match app.state::<ModelState>().0.get() {
        None => ModelStatus::Loading,
        Some(Ok(_)) => ModelStatus::Ready,
        Some(Err(e)) => ModelStatus::Failed(e.clone()),
    }
}

fn model(app: &AppHandle) -> Result<&ModelStore, AppError> {
    match app.state::<ModelState>().inner().0.get() {
        None => Err(AppError::ModelNotReady("the model is still loading".into())),
        Some(Err(e)) => Err(AppError::ModelNotReady(e.clone())),
        Some(Ok(m)) => Ok(m),
    }
}

/// Runs CPU or database work off the async runtime.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

fn with_db<T>(app: &AppHandle, f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, AppError>) -> Result<T, AppError> {
    let db = app.state::<Db>();
    let mut conn = db.lock().map_err(|_| AppError::Internal("database lock poisoned".into()))?;
    f(&mut conn)
}

fn check_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::InvalidInput("run name must be 1 to 200 characters".into()));
    }
    Ok(name)
}

fn check_threshold(t: f64) -> Result<f64, AppError> {
    if (0.0..=1.0).contains(&t) { Ok(t) } else { Err(AppError::InvalidInput("threshold must be between 0 and 1".into())) }
}

fn predict_rows(model: &ModelStore, molecules: &[MolIn]) -> Result<Vec<Option<Prediction>>, AppError> {
    let fps = molecules.iter().map(MolIn::validate).collect::<Result<Vec<_>, _>>()?;
    Ok(fps.par_iter().map(|fp| fp.as_ref().map(|fp| model.predict(fp))).collect())
}

fn row(m: MolIn, prediction: Option<Prediction>) -> MolRow {
    MolRow {
        index: m.index,
        input_id: m.input_id,
        smiles: m.smiles,
        canonical: m.canonical,
        error: m.error,
        descriptors: m.descriptors,
        prediction,
    }
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    let log_dir = app.path().app_log_dir().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(AppInfo { version: app.package_info().version.to_string(), log_dir: log_dir.display().to_string() })
}

#[tauri::command]
pub async fn model_status(app: AppHandle) -> Result<ModelStatus, AppError> {
    Ok(model_status_of(&app))
}

#[tauri::command]
pub async fn reference_data(app: AppHandle) -> Result<ReferenceData, AppError> {
    Ok(model(&app)?.reference.clone())
}

#[tauri::command]
pub async fn create_run(app: AppHandle, name: String, threshold: f64, input_kind: String) -> Result<i64, AppError> {
    let name = check_name(&name)?.to_owned();
    let threshold = check_threshold(threshold)?;
    if !INPUT_KINDS.contains(&input_kind.as_str()) {
        return Err(AppError::InvalidInput(format!("unknown input kind {input_kind}")));
    }
    blocking(app, move |app| {
        let version = model(app)?.reference.model_version.clone();
        let app_version = app.package_info().version.to_string();
        with_db(app, |c| store::create_run(c, &name, threshold, &version, &app_version, &input_kind))
    })
    .await
}

/// Predicts a chunk of molecules, stores them under the run, and returns the rows.
#[tauri::command]
pub async fn predict_chunk(app: AppHandle, run_id: i64, molecules: Vec<MolIn>) -> Result<Vec<MolRow>, AppError> {
    if molecules.len() > MAX_CHUNK {
        return Err(AppError::InvalidInput(format!("at most {MAX_CHUNK} molecules per chunk")));
    }
    blocking(app, move |app| {
        let start = std::time::Instant::now();
        let predictions = predict_rows(model(app)?, &molecules)?;
        let pairs: Vec<_> = molecules.iter().zip(predictions.iter().map(Option::as_ref)).collect();
        with_db(app, |c| store::insert_molecules(c, run_id, &pairs))?;
        log::debug!("run {run_id}: {} molecules in {:?}", molecules.len(), start.elapsed());
        Ok(molecules.into_iter().zip(predictions).map(|(m, p)| row(m, p)).collect())
    })
    .await
}

/// Predicts one molecule without storing it.
#[tauri::command]
pub async fn predict_one(app: AppHandle, molecule: MolIn) -> Result<MolRow, AppError> {
    blocking(app, move |app| {
        let prediction = predict_rows(model(app)?, std::slice::from_ref(&molecule))?.pop().flatten();
        Ok(row(molecule, prediction))
    })
    .await
}

#[tauri::command]
pub async fn list_runs(app: AppHandle) -> Result<Vec<RunSummary>, AppError> {
    blocking(app, |app| with_db(app, |c| store::list_runs(c))).await
}

#[tauri::command]
pub async fn get_run(app: AppHandle, run_id: i64) -> Result<RunSummary, AppError> {
    blocking(app, move |app| with_db(app, |c| store::get_run(c, run_id))).await
}

#[tauri::command]
pub async fn get_run_rows(app: AppHandle, run_id: i64, offset: u32, limit: u32) -> Result<Vec<MolRow>, AppError> {
    if limit as usize > MAX_CHUNK {
        return Err(AppError::InvalidInput(format!("at most {MAX_CHUNK} rows per page")));
    }
    blocking(app, move |app| with_db(app, |c| store::get_rows(c, run_id, offset, limit))).await
}

#[tauri::command]
pub async fn rename_run(app: AppHandle, run_id: i64, name: String) -> Result<(), AppError> {
    let name = check_name(&name)?.to_owned();
    blocking(app, move |app| with_db(app, |c| store::rename_run(c, run_id, &name))).await
}

#[tauri::command]
pub async fn set_run_threshold(app: AppHandle, run_id: i64, threshold: f64) -> Result<(), AppError> {
    let threshold = check_threshold(threshold)?;
    blocking(app, move |app| with_db(app, |c| store::set_threshold(c, run_id, threshold))).await
}

#[tauri::command]
pub async fn delete_run(app: AppHandle, run_id: i64) -> Result<(), AppError> {
    blocking(app, move |app| with_db(app, |c| store::delete_run(c, run_id))).await
}

/// A file name derived from the run name, without characters Windows or macOS reject.
fn file_stem(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .take(100)
        .collect();
    let s = s.trim().trim_end_matches('.').to_owned();
    if s.is_empty() { "run".into() } else { s }
}

/// Asks for a destination in a native save dialog and writes the run there.
/// Returns None when the dialog is cancelled.
#[tauri::command]
pub async fn export_run(app: AppHandle, run_id: i64, format: String) -> Result<Option<ExportResult>, AppError> {
    let (ext, label) = match format.as_str() {
        "csv" => ("csv", "CSV"),
        "xlsx" => ("xlsx", "Excel workbook"),
        "sdf" => ("sdf", "SD file"),
        _ => return Err(AppError::InvalidInput(format!("unknown export format {format}"))),
    };
    blocking(app, move |app| {
        let run = with_db(app, |c| store::get_run(c, run_id))?;
        let rows = with_db(app, |c| store::export_rows(c, run_id))?;
        let m = model(app)?;
        let table = export::table(&rows, run.threshold, m.reference.forests as usize, &m.reference.train.chembl_id);
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!("{}.{ext}", file_stem(&run.name)))
            .add_filter(label, &[ext])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| AppError::Io(e.to_string()))?;
        let (written, skipped) = match ext {
            "csv" => {
                std::fs::write(&path, export::to_csv(&table))?;
                (rows.len() as u32, 0)
            }
            "xlsx" => {
                export::write_xlsx(&table, &run, &path)?;
                (rows.len() as u32, 0)
            }
            _ => {
                let (sdf, written, skipped) = export::to_sdf(&table, &rows);
                std::fs::write(&path, sdf)?;
                (written, skipped)
            }
        };
        log::info!("run {run_id} exported as {ext}: {written} written, {skipped} skipped");
        Ok(Some(ExportResult { path: path.display().to_string(), written, skipped }))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::file_stem;

    #[test]
    fn file_stem_replaces_reserved_characters() {
        assert_eq!(file_stem("Run: a/b?"), "Run_ a_b_");
        assert_eq!(file_stem("  ..  "), "run");
        assert_eq!(file_stem(&"x".repeat(300)).len(), 100);
    }
}
