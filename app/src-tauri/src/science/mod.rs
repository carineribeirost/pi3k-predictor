pub mod analogs;
pub mod domain;
pub mod forest;

use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use analogs::Fingerprint;
use domain::Domain;
use forest::Ensemble;

/// Nearest training analogs kept per molecule.
const ANALOGS: usize = 5;

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Analog {
    pub train_index: u32,
    pub similarity: f64,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Prediction {
    /// The 32 model inputs; bit i is selected fingerprint bit i.
    pub bits: u32,
    /// P(active) from each forest, in model file order.
    pub probs: Vec<f64>,
    pub mean: f64,
    /// Population standard deviation across the forests.
    pub std: f64,
    pub pca: [f64; 2],
    pub leverage: f64,
    pub distance: f64,
    pub in_leverage: bool,
    pub in_distance: bool,
    pub analogs: Vec<Analog>,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BitInfo {
    pub bit: u32,
    pub importance: f64,
    pub freq_active: f64,
    pub freq_inactive: f64,
    /// Common atom environments that set this bit, as SMARTS.
    pub smarts: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrainSet {
    pub chembl_id: Vec<String>,
    pub smiles: Vec<String>,
    pub pic50: Vec<f64>,
    pub active: Vec<u8>,
    pub pca: Vec<[f64; 2]>,
    pub leverage: Vec<f64>,
    pub distance: Vec<f64>,
}

/// Everything the UI needs about the model and its training set.
#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReferenceData {
    pub model_version: String,
    pub forests: u32,
    pub leverage_threshold: f64,
    pub distance_threshold: f64,
    pub k: u32,
    pub selected_bits: Vec<u32>,
    pub bits: Vec<BitInfo>,
    pub train: TrainSet,
}

#[derive(Deserialize)]
struct ReferenceFile {
    radius: u32,
    n_bits: u32,
    selected_bits: Vec<u32>,
    pca_mean: Vec<f64>,
    pca_components: Vec<Vec<f64>>,
    xtx_inv: Vec<Vec<f64>>,
    leverage_threshold: f64,
    distance_threshold: f64,
    k: u32,
    train: TrainSet,
}

#[derive(Deserialize)]
struct Manifest {
    model_version: String,
}

pub struct ModelStore {
    ensemble: Ensemble,
    domain: Domain,
    selected: [u16; 32],
    train_fps: Vec<Fingerprint>,
    pub reference: ReferenceData,
}

fn read(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    std::fs::read(dir.join(name)).map_err(|e| format!("cannot read {name}: {e}"))
}

fn json<T: for<'de> Deserialize<'de>>(dir: &Path, name: &str) -> Result<T, String> {
    serde_json::from_slice(&read(dir, name)?).map_err(|e| format!("invalid {name}: {e}"))
}

fn arr<const N: usize>(v: &[f64], what: &str) -> Result<[f64; N], String> {
    v.try_into().map_err(|_| format!("{what} must have {N} values"))
}

impl ModelStore {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let compressed = read(dir, "model.bin.zst")?;
        let mut raw = Vec::new();
        ruzstd::decoding::StreamingDecoder::new(compressed.as_slice())
            .map_err(|e| format!("model.bin.zst: {e}"))?
            .read_to_end(&mut raw)
            .map_err(|e| format!("model.bin.zst: {e}"))?;
        let ensemble = Ensemble::parse(&raw)?;

        let r: ReferenceFile = json(dir, "reference.json")?;
        let bits: Vec<BitInfo> = json(dir, "bits.json")?;
        let manifest: Manifest = json(dir, "model_manifest.json")?;

        if r.radius != 3 || r.n_bits != 2048 || r.k == 0 {
            return Err("reference.json: unexpected fingerprint settings".into());
        }
        let selected: [u16; 32] = r
            .selected_bits
            .iter()
            .map(|&b| u16::try_from(b).ok().filter(|&b| b < 2048))
            .collect::<Option<Vec<_>>>()
            .and_then(|v| v.try_into().ok())
            .ok_or("reference.json: selected_bits must be 32 indices below 2048")?;
        let [c0, c1] = r.pca_components.as_slice() else {
            return Err("reference.json: pca_components must have 2 rows".into());
        };
        let [x0, x1] = r.xtx_inv.as_slice() else {
            return Err("reference.json: xtx_inv must be 2x2".into());
        };
        let t = &r.train;
        let n = t.smiles.len();
        if [t.chembl_id.len(), t.pic50.len(), t.active.len(), t.pca.len(), t.leverage.len(), t.distance.len()]
            .iter()
            .any(|&len| len != n)
            || n == 0
        {
            return Err("reference.json: training arrays differ in length".into());
        }
        let fp_bytes = read(dir, "train_fps.bin")?;
        if fp_bytes.len() != n * 256 {
            return Err("train_fps.bin does not match the training set size".into());
        }
        let train_fps = fp_bytes
            .as_chunks::<256>()
            .0
            .iter()
            .map(|row| {
                let mut fp = [0u64; 32];
                for (w, c) in fp.iter_mut().zip(row.as_chunks::<8>().0) {
                    *w = u64::from_le_bytes(*c);
                }
                fp
            })
            .collect();
        if bits.len() != 32 || bits.iter().zip(&selected).any(|(b, &s)| b.bit != u32::from(s)) {
            return Err("bits.json does not match the selected bits".into());
        }

        let domain = Domain {
            mean: arr(&r.pca_mean, "pca_mean")?,
            components: [arr(c0, "pca_components")?, arr(c1, "pca_components")?],
            xtx_inv: [arr(x0, "xtx_inv")?, arr(x1, "xtx_inv")?],
            leverage_threshold: r.leverage_threshold,
            distance_threshold: r.distance_threshold,
            k: r.k as usize,
            train: t.pca.clone(),
        };
        let forests = ensemble.predict(0).len() as u32;
        Ok(Self {
            ensemble,
            domain,
            selected,
            train_fps,
            reference: ReferenceData {
                model_version: manifest.model_version,
                forests,
                leverage_threshold: r.leverage_threshold,
                distance_threshold: r.distance_threshold,
                k: r.k,
                selected_bits: r.selected_bits,
                bits,
                train: r.train,
            },
        })
    }

    /// The 32 model inputs packed into a u32; bit i is selected fingerprint bit i.
    pub fn model_bits(&self, fp: &Fingerprint) -> u32 {
        self.selected
            .iter()
            .enumerate()
            .fold(0, |acc, (i, &b)| acc | (((fp[usize::from(b / 64)] >> (b % 64)) & 1) as u32) << i)
    }

    pub fn predict(&self, fp: &Fingerprint) -> Prediction {
        let bits = self.model_bits(fp);
        let probs = self.ensemble.predict(bits);
        let n = probs.len() as f64;
        let mean = probs.iter().sum::<f64>() / n;
        let std = (probs.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / n).sqrt();
        let pca = self.domain.project(bits);
        let leverage = self.domain.leverage(pca);
        let distance = self.domain.knn_distance(pca);
        Prediction {
            bits,
            probs,
            mean,
            std,
            pca,
            leverage,
            distance,
            in_leverage: leverage <= self.domain.leverage_threshold,
            in_distance: distance <= self.domain.distance_threshold,
            analogs: analogs::top_k(&self.train_fps, fp, ANALOGS)
                .into_iter()
                .map(|(train_index, similarity)| Analog { train_index, similarity })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rayon::prelude::*;
    use std::path::PathBuf;
    use std::sync::LazyLock;

    static MODEL: LazyLock<ModelStore> =
        LazyLock::new(|| ModelStore::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")).unwrap());

    #[derive(Deserialize)]
    struct Golden {
        rows: Vec<GoldenRow>,
    }

    #[derive(Deserialize)]
    struct GoldenRow {
        bits: Vec<u8>,
        probs: Vec<f64>,
        mean: f64,
    }

    #[test]
    fn forests_match_scikit_learn_exactly() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden/legacy.json");
        let golden: Golden = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(golden.rows.len(), 532);
        for row in &golden.rows {
            let bits = row.bits.iter().enumerate().fold(0u32, |acc, (i, &b)| acc | u32::from(b) << i);
            let probs = MODEL.ensemble.predict(bits);
            for (got, want) in probs.iter().zip(&row.probs) {
                assert!((got - want).abs() < 1e-12, "forest probability {got} != {want}");
            }
            let mean = probs.iter().sum::<f64>() / probs.len() as f64;
            assert!((mean - row.mean).abs() < 1e-12);
        }
    }

    #[test]
    fn domain_reproduces_exported_training_values() {
        let t = &MODEL.reference.train;
        for (i, fp) in MODEL.train_fps.iter().enumerate() {
            let p = MODEL.predict(fp);
            assert!((p.pca[0] - t.pca[i][0]).abs() < 2e-6 && (p.pca[1] - t.pca[i][1]).abs() < 2e-6, "pca row {i}");
            assert!((p.leverage - t.leverage[i]).abs() < 1e-7, "leverage row {i}");
            assert!((p.distance - t.distance[i]).abs() < 2e-6, "distance row {i}");
            assert_eq!(p.analogs[0].similarity, 1.0, "row {i} should find itself");
        }
    }

    #[test]
    #[ignore = "speed check: cargo test --release -- --ignored"]
    fn predicts_100k_quickly() {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        let fps: Vec<Fingerprint> = (0..100_000)
            .map(|_| {
                std::array::from_fn(|_| {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    state & state.rotate_left(17) & state.rotate_left(31)
                })
            })
            .collect();
        let start = std::time::Instant::now();
        let n = fps.par_iter().map(|fp| MODEL.predict(fp)).filter(|p| p.mean >= 0.5).count();
        let elapsed = start.elapsed();
        println!("100k predictions in {elapsed:?} ({n} active)");
        assert!(elapsed.as_secs_f64() < 10.0);
    }
}
