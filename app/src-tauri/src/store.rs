//! Run history in SQLite.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;
use crate::science::Prediction;
use crate::science::analogs::Fingerprint;

pub type Db = Mutex<Connection>;

const MIGRATIONS: &[&str] = &["
    CREATE TABLE runs (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        threshold REAL NOT NULL,
        model_version TEXT NOT NULL,
        app_version TEXT NOT NULL,
        input_kind TEXT NOT NULL
    );
    CREATE TABLE molecules (
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        input_id TEXT,
        smiles TEXT NOT NULL,
        canonical TEXT,
        error TEXT,
        molblock TEXT,
        descriptors TEXT,
        prediction TEXT,
        mean REAL,
        in_domain INTEGER,
        PRIMARY KEY (run_id, idx)
    );
    CREATE INDEX molecules_mean ON molecules (run_id, mean);
"];

pub fn open(path: &Path) -> Result<Connection, AppError> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<(), AppError> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in (1i64..).zip(MIGRATIONS).skip_while(|(i, _)| *i <= version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i)?;
        tx.commit()?;
    }
    Ok(())
}

/// One input molecule as prepared by the WebView. `fp` is the 2048-bit Morgan
/// fingerprint as 64 u32 words (low word first); it is absent when parsing failed.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MolIn {
    pub index: u32,
    pub input_id: Option<String>,
    pub smiles: String,
    pub canonical: Option<String>,
    pub error: Option<String>,
    pub fp: Option<Vec<u32>>,
    pub molblock: Option<String>,
    /// RDKit descriptors as a JSON object string.
    pub descriptors: Option<String>,
}

fn too_long(s: &Option<String>, max: usize) -> bool {
    s.as_ref().is_some_and(|s| s.len() > max)
}

impl MolIn {
    /// Checks shape and sizes, and returns the fingerprint for a parsed molecule.
    pub fn validate(&self) -> Result<Option<Fingerprint>, AppError> {
        let bad = |what: &str| Err(AppError::InvalidInput(format!("molecule {}: {what}", self.index)));
        if self.smiles.len() > 2_000
            || too_long(&self.input_id, 200)
            || too_long(&self.canonical, 4_000)
            || too_long(&self.error, 1_000)
            || too_long(&self.molblock, 500_000)
            || too_long(&self.descriptors, 20_000)
        {
            return bad("a field is too long");
        }
        match (&self.fp, &self.error) {
            (Some(words), None) if words.len() == 64 => {
                let mut fp = [0u64; 32];
                for (w, pair) in fp.iter_mut().zip(words.chunks_exact(2)) {
                    *w = u64::from(pair[0]) | u64::from(pair[1]) << 32;
                }
                Ok(Some(fp))
            }
            (None, Some(_)) => Ok(None),
            _ => bad("needs either a 64-word fingerprint or an error"),
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MolRow {
    pub index: u32,
    pub input_id: Option<String>,
    pub smiles: String,
    pub canonical: Option<String>,
    pub error: Option<String>,
    pub descriptors: Option<String>,
    pub prediction: Option<Prediction>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunSummary {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub threshold: f64,
    pub model_version: String,
    pub app_version: String,
    pub input_kind: String,
    pub n_total: u32,
    pub n_valid: u32,
    pub n_active: u32,
    pub n_in_domain: u32,
}

pub fn create_run(
    conn: &Connection,
    name: &str,
    threshold: f64,
    model_version: &str,
    app_version: &str,
    input_kind: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO runs (name, threshold, model_version, app_version, input_kind) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, threshold, model_version, app_version, input_kind],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_molecules(conn: &mut Connection, run_id: i64, rows: &[(&MolIn, Option<&Prediction>)]) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO molecules (run_id, idx, input_id, smiles, canonical, error, molblock, descriptors, prediction, mean, in_domain)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        for (m, p) in rows {
            let json = p.map(serde_json::to_string).transpose().map_err(|e| AppError::Internal(e.to_string()))?;
            stmt.execute(params![
                run_id,
                m.index,
                m.input_id,
                m.smiles,
                m.canonical,
                m.error,
                m.molblock,
                m.descriptors,
                json,
                p.map(|p| p.mean),
                p.map(|p| p.in_leverage && p.in_distance),
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

const SUMMARY: &str = "
    SELECT r.id, r.name, r.created_at, r.threshold, r.model_version, r.app_version, r.input_kind,
           COUNT(m.idx), COUNT(m.mean), COUNT(CASE WHEN m.mean >= r.threshold THEN 1 END), COUNT(CASE WHEN m.in_domain THEN 1 END)
    FROM runs r LEFT JOIN molecules m ON m.run_id = r.id";

fn summary(row: &rusqlite::Row) -> rusqlite::Result<RunSummary> {
    Ok(RunSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        threshold: row.get(3)?,
        model_version: row.get(4)?,
        app_version: row.get(5)?,
        input_kind: row.get(6)?,
        n_total: row.get(7)?,
        n_valid: row.get(8)?,
        n_active: row.get(9)?,
        n_in_domain: row.get(10)?,
    })
}

pub fn list_runs(conn: &Connection) -> Result<Vec<RunSummary>, AppError> {
    let mut stmt = conn.prepare(&format!("{SUMMARY} GROUP BY r.id ORDER BY r.id DESC"))?;
    let rows = stmt.query_map([], summary)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get_run(conn: &Connection, id: i64) -> Result<RunSummary, AppError> {
    conn.query_row(&format!("{SUMMARY} WHERE r.id = ?1 GROUP BY r.id"), [id], summary)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("run {id}")))
}

pub fn get_rows(conn: &Connection, id: i64, offset: u32, limit: u32) -> Result<Vec<MolRow>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT idx, input_id, smiles, canonical, error, descriptors, prediction
         FROM molecules WHERE run_id = ?1 ORDER BY idx LIMIT ?2 OFFSET ?3",
    )?;
    let rows = stmt
        .query_map(params![id, limit, offset], |r| {
            Ok((
                MolRow {
                    index: r.get(0)?,
                    input_id: r.get(1)?,
                    smiles: r.get(2)?,
                    canonical: r.get(3)?,
                    error: r.get(4)?,
                    descriptors: r.get(5)?,
                    prediction: None,
                },
                r.get::<_, Option<String>>(6)?,
            ))
        })?
        .map(|row| {
            let (mut mol, json) = row?;
            mol.prediction = json.map(|j| serde_json::from_str(&j)).transpose().map_err(|e| AppError::Db(e.to_string()))?;
            Ok(mol)
        })
        .collect::<Result<_, AppError>>()?;
    Ok(rows)
}

fn changed(n: usize, id: i64) -> Result<(), AppError> {
    if n == 0 { Err(AppError::NotFound(format!("run {id}"))) } else { Ok(()) }
}

pub fn rename_run(conn: &Connection, id: i64, name: &str) -> Result<(), AppError> {
    changed(conn.execute("UPDATE runs SET name = ?1 WHERE id = ?2", params![name, id])?, id)
}

pub fn set_threshold(conn: &Connection, id: i64, threshold: f64) -> Result<(), AppError> {
    changed(conn.execute("UPDATE runs SET threshold = ?1 WHERE id = ?2", params![threshold, id])?, id)
}

pub fn delete_run(conn: &Connection, id: i64) -> Result<(), AppError> {
    changed(conn.execute("DELETE FROM runs WHERE id = ?1", [id])?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mol(index: u32, fp: Option<Vec<u32>>, error: Option<&str>) -> MolIn {
        MolIn {
            index,
            input_id: None,
            smiles: "CCO".into(),
            canonical: None,
            error: error.map(Into::into),
            fp,
            molblock: None,
            descriptors: None,
        }
    }

    #[test]
    fn validate_requires_fp_xor_error() {
        assert!(mol(0, Some(vec![0; 64]), None).validate().unwrap().is_some());
        assert!(mol(0, None, Some("bad")).validate().unwrap().is_none());
        assert!(mol(0, Some(vec![0; 63]), None).validate().is_err());
        assert!(mol(0, None, None).validate().is_err());
        assert!(mol(0, Some(vec![0; 64]), Some("bad")).validate().is_err());
    }

    #[test]
    fn validate_packs_words_low_first() {
        let mut words = vec![0; 64];
        words[0] = 1;
        words[1] = 2;
        let fp = mol(0, Some(words), None).validate().unwrap().unwrap();
        assert_eq!(fp[0], 1 | 2 << 32);
    }

    #[test]
    fn runs_round_trip_and_cascade() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        let id = create_run(&conn, "test", 0.5, "1.0.0", "0.1.0", "paste").unwrap();
        let ok = mol(0, Some(vec![0; 64]), None);
        let bad = mol(1, None, Some("unclosed ring"));
        let p = Prediction {
            bits: 0,
            probs: vec![0.9; 10],
            mean: 0.9,
            std: 0.0,
            pca: [0.0, 0.0],
            leverage: 0.0,
            distance: 0.0,
            in_leverage: true,
            in_distance: true,
            analogs: vec![],
        };
        insert_molecules(&mut conn, id, &[(&ok, Some(&p)), (&bad, None)]).unwrap();
        let s = get_run(&conn, id).unwrap();
        assert_eq!((s.n_total, s.n_valid, s.n_active, s.n_in_domain), (2, 1, 1, 1));
        set_threshold(&conn, id, 0.95).unwrap();
        assert_eq!(get_run(&conn, id).unwrap().n_active, 0);
        let rows = get_rows(&conn, id, 0, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].prediction.as_ref().unwrap().mean, 0.9);
        assert_eq!(rows[1].error.as_deref(), Some("unclosed ring"));
        delete_run(&conn, id).unwrap();
        assert!(get_run(&conn, id).is_err());
        let left: u32 = conn.query_row("SELECT COUNT(*) FROM molecules", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
