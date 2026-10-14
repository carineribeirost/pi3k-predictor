//! CSV, Excel and SD file exports of a run.

use std::fmt::Write as _;
use std::path::Path;

use rust_xlsxwriter::{ConditionalFormat3ColorScale, Format, Workbook};
use serde::Serialize;
use ts_rs::TS;

use crate::error::AppError;
use crate::store::{MolRow, RunSummary};

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportResult {
    pub path: String,
    pub written: u32,
    /// Rows left out because they have no structure (SD files only).
    pub skipped: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Text(String),
    Num(f64),
    Empty,
}

pub struct Table {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
}

const DESCRIPTORS: [(&str, &str); 6] = [
    ("mw", "amw"),
    ("clogp", "CrippenClogP"),
    ("tpsa", "tpsa"),
    ("hbd", "lipinskiHBD"),
    ("hba", "lipinskiHBA"),
    ("rotatable_bonds", "NumRotatableBonds"),
];

fn text(s: Option<&str>) -> Cell {
    s.map_or(Cell::Empty, |s| Cell::Text(s.to_owned()))
}

/// One row per input molecule, in input order, with every value the app computed.
pub fn table(rows: &[(MolRow, Option<String>)], threshold: f64, forests: usize, chembl: &[String]) -> Table {
    let mut headers: Vec<String> =
        ["row", "input_id", "smiles", "canonical_smiles", "status", "error", "p_active", "prediction", "std"]
            .map(String::from)
            .to_vec();
    headers.extend((1..=forests).map(|i| format!("p_forest_{i}")));
    headers.extend(
        ["pca1", "pca2", "leverage", "distance", "in_domain", "nn1_chembl_id", "nn1_similarity"].map(String::from),
    );
    headers.extend(DESCRIPTORS.iter().map(|(h, _)| (*h).to_owned()));

    let body = rows
        .iter()
        .map(|(m, _)| {
            let mut r = vec![
                Cell::Num(f64::from(m.index + 1)),
                text(m.input_id.as_deref()),
                Cell::Text(m.smiles.clone()),
                text(m.canonical.as_deref()),
                Cell::Text(if m.prediction.is_some() { "ok" } else { "invalid" }.into()),
                text(m.error.as_deref()),
            ];
            match &m.prediction {
                Some(p) => {
                    r.push(Cell::Num(p.mean));
                    r.push(Cell::Text(if p.mean >= threshold { "active" } else { "inactive" }.into()));
                    r.push(Cell::Num(p.std));
                    r.extend((0..forests).map(|i| p.probs.get(i).map_or(Cell::Empty, |&x| Cell::Num(x))));
                    r.push(Cell::Num(p.pca[0]));
                    r.push(Cell::Num(p.pca[1]));
                    r.push(Cell::Num(p.leverage));
                    r.push(Cell::Num(p.distance));
                    r.push(Cell::Text((p.in_leverage && p.in_distance).to_string()));
                    let nn = p.analogs.first();
                    r.push(text(nn.and_then(|a| chembl.get(a.train_index as usize)).map(String::as_str)));
                    r.push(nn.map_or(Cell::Empty, |a| Cell::Num(a.similarity)));
                }
                None => r.extend(std::iter::repeat_n(Cell::Empty, 3 + forests + 7)),
            }
            let desc: Option<serde_json::Value> = m.descriptors.as_deref().and_then(|d| serde_json::from_str(d).ok());
            r.extend(DESCRIPTORS.iter().map(|(_, key)| {
                desc.as_ref().and_then(|d| d.get(key)).and_then(serde_json::Value::as_f64).map_or(Cell::Empty, Cell::Num)
            }));
            r
        })
        .collect();
    Table { headers, rows: body }
}

fn csv_field(out: &mut String, s: &str) {
    if s.contains([',', '"', '\n', '\r']) {
        out.push('"');
        out.push_str(&s.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(s);
    }
}

pub fn to_csv(t: &Table) -> String {
    let mut out = String::new();
    let line = |out: &mut String, cells: &mut dyn Iterator<Item = String>| {
        for (i, c) in cells.enumerate() {
            if i > 0 {
                out.push(',');
            }
            csv_field(out, &c);
        }
        out.push_str("\r\n");
    };
    line(&mut out, &mut t.headers.iter().cloned());
    for r in &t.rows {
        line(
            &mut out,
            &mut r.iter().map(|c| match c {
                Cell::Text(s) => s.clone(),
                Cell::Num(x) => x.to_string(),
                Cell::Empty => String::new(),
            }),
        );
    }
    out
}

fn xlsx_err(e: rust_xlsxwriter::XlsxError) -> AppError {
    AppError::Io(e.to_string())
}

pub fn write_xlsx(t: &Table, run: &RunSummary, path: &Path) -> Result<(), AppError> {
    let mut wb = Workbook::new();
    let bold = Format::new().set_bold();
    let ws = wb.add_worksheet().set_name("Results").map_err(xlsx_err)?;
    for (c, h) in t.headers.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, h, &bold).map_err(xlsx_err)?;
    }
    for (r, row) in t.rows.iter().enumerate() {
        let r = r as u32 + 1;
        for (c, cell) in row.iter().enumerate() {
            match cell {
                Cell::Text(s) => ws.write_string(r, c as u16, s).map(|_| ()),
                Cell::Num(x) => ws.write_number(r, c as u16, *x).map(|_| ()),
                Cell::Empty => Ok(()),
            }
            .map_err(xlsx_err)?;
        }
    }
    let last_row = t.rows.len() as u32;
    let last_col = t.headers.len() as u16 - 1;
    ws.autofilter(0, 0, last_row, last_col).map_err(xlsx_err)?;
    ws.set_freeze_panes(1, 0).map_err(xlsx_err)?;
    ws.set_column_width(2, 40).map_err(xlsx_err)?;
    if let Some(p) = t.headers.iter().position(|h| h == "p_active") {
        let scale = ConditionalFormat3ColorScale::new();
        ws.add_conditional_format(1, p as u16, last_row.max(1), p as u16, &scale).map_err(xlsx_err)?;
    }

    let info = wb.add_worksheet().set_name("Run info").map_err(xlsx_err)?;
    let entries: [(&str, String); 7] = [
        ("Run", run.name.clone()),
        ("Created", run.created_at.clone()),
        ("Threshold", run.threshold.to_string()),
        ("Model version", run.model_version.clone()),
        ("App version", run.app_version.clone()),
        ("Molecules", run.n_total.to_string()),
        ("Predicted", run.n_valid.to_string()),
    ];
    for (r, (k, v)) in entries.iter().enumerate() {
        info.write_string_with_format(r as u32, 0, *k, &bold).map_err(xlsx_err)?;
        info.write_string(r as u32, 1, v).map_err(xlsx_err)?;
    }
    info.set_column_width(0, 18).map_err(xlsx_err)?;
    info.set_column_width(1, 40).map_err(xlsx_err)?;
    wb.save(path).map_err(xlsx_err)
}

/// SD file with every table column as a data field. Rows without a structure are skipped.
pub fn to_sdf(t: &Table, rows: &[(MolRow, Option<String>)]) -> (String, u32, u32) {
    let mut out = String::new();
    let (mut written, mut skipped) = (0, 0);
    for ((m, molblock), cells) in rows.iter().zip(&t.rows) {
        let Some(block) = molblock.as_deref().filter(|_| m.prediction.is_some()) else {
            skipped += 1;
            continue;
        };
        let title = m.input_id.clone().unwrap_or_else(|| format!("molecule {}", m.index + 1));
        let mut lines = block.lines();
        lines.next();
        out.push_str(&title.replace(['\r', '\n'], " "));
        out.push('\n');
        for l in lines {
            out.push_str(l);
            out.push('\n');
        }
        for (h, c) in t.headers.iter().zip(cells) {
            let v = match c {
                Cell::Text(s) => s.replace(['\r', '\n'], " "),
                Cell::Num(x) => x.to_string(),
                Cell::Empty => continue,
            };
            let _ = write!(out, "> <{h}>\n{v}\n\n");
        }
        out.push_str("$$$$\n");
        written += 1;
    }
    (out, written, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::science::{Analog, Prediction};

    fn rows() -> Vec<(MolRow, Option<String>)> {
        let p = Prediction {
            bits: 0,
            probs: vec![0.8, 0.6],
            mean: 0.7,
            std: 0.1,
            pca: [0.5, -0.25],
            leverage: 0.001,
            distance: 0.2,
            in_leverage: true,
            in_distance: true,
            analogs: vec![Analog { train_index: 1, similarity: 0.5 }],
        };
        let ok = MolRow {
            index: 0,
            input_id: Some("a, \"quoted\"".into()),
            smiles: "CCO".into(),
            canonical: Some("CCO".into()),
            error: None,
            descriptors: Some(r#"{"amw": 46.07, "tpsa": 20.23}"#.into()),
            prediction: Some(p),
        };
        let bad = MolRow {
            index: 1,
            input_id: None,
            smiles: "C1CC(".into(),
            canonical: None,
            error: Some("RDKit could not parse this SMILES".into()),
            descriptors: None,
            prediction: None,
        };
        let block = "\n     RDKit          2D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\nM  END\n".to_owned();
        vec![(ok, Some(block)), (bad, None)]
    }

    #[test]
    fn table_has_one_aligned_row_per_input() {
        let t = table(&rows(), 0.5, 2, &["CHEMBL1".into(), "CHEMBL2".into()]);
        assert!(t.rows.iter().all(|r| r.len() == t.headers.len()));
        let col = |name: &str| t.headers.iter().position(|h| h == name).unwrap();
        assert_eq!(t.rows[0][col("prediction")], Cell::Text("active".into()));
        assert_eq!(t.rows[0][col("nn1_chembl_id")], Cell::Text("CHEMBL2".into()));
        assert_eq!(t.rows[0][col("mw")], Cell::Num(46.07));
        assert_eq!(t.rows[1][col("status")], Cell::Text("invalid".into()));
        assert_eq!(t.rows[1][col("p_active")], Cell::Empty);
    }

    #[test]
    fn csv_quotes_fields_that_need_it() {
        let csv = to_csv(&table(&rows(), 0.5, 2, &[]));
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert!(lines[0].starts_with("row,input_id,smiles"));
        assert!(lines[1].starts_with("1,\"a, \"\"quoted\"\"\",CCO,CCO,ok,,0.7,active,"));
        assert!(lines[2].starts_with("2,,C1CC(,,invalid,RDKit could not parse this SMILES,"));
    }

    #[test]
    fn sdf_titles_records_and_skips_invalid() {
        let r = rows();
        let (sdf, written, skipped) = to_sdf(&table(&r, 0.5, 2, &[]), &r);
        assert_eq!((written, skipped), (1, 1));
        assert!(sdf.starts_with("a, \"quoted\"\n     RDKit"));
        assert!(sdf.contains("M  END\n> <row>\n1\n\n"));
        assert!(sdf.contains("> <p_active>\n0.7\n\n"));
        assert!(!sdf.contains("> <error>"));
        assert_eq!(sdf.matches("$$$$").count(), 1);
    }

    #[test]
    fn xlsx_is_written() {
        let r = rows();
        let run = RunSummary {
            id: 1,
            name: "t".into(),
            created_at: "2026-10-14T00:00:00Z".into(),
            threshold: 0.5,
            model_version: "1.0.0".into(),
            app_version: "0.1.0".into(),
            input_kind: "paste".into(),
            n_total: 2,
            n_valid: 1,
            n_active: 1,
            n_in_domain: 1,
        };
        let path = std::env::temp_dir().join(format!("pi3k-export-test-{}.xlsx", std::process::id()));
        write_xlsx(&table(&r, 0.5, 2, &[]), &run, &path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(&bytes[..2], b"PK");
    }
}
