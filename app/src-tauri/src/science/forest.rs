//! Evaluation of the exported RandomForest ensemble (see tools/export/export_models.py).

const MAGIC: &[u8; 8] = b"PI3KRF02";
const LEAF: u8 = 255;
const N_FEATURES: u8 = 32;

struct Tree {
    feature: Vec<u8>,
    payload: Vec<u32>,
    leaf_p: Vec<f64>,
}

impl Tree {
    /// P(active) for one input. Bit `i` of `bits` is model feature `i`.
    fn eval(&self, bits: u32) -> f64 {
        let mut i = 0;
        loop {
            let f = self.feature[i];
            if f == LEAF {
                return self.leaf_p[self.payload[i] as usize];
            }
            i = if bits >> f & 1 == 1 { self.payload[i] as usize } else { i + 1 };
        }
    }
}

/// The forests in file order; each forest's probability is the mean over its trees.
pub struct Ensemble {
    forests: Vec<Vec<Tree>>,
}

struct Reader<'a> {
    raw: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.raw.len()).ok_or("model file is truncated")?;
        let s = &self.raw[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("4 bytes")))
    }
}

impl Ensemble {
    /// Parses and validates the uncompressed model bytes. Validation guarantees every
    /// traversal terminates inside the arrays: child indices always move forward.
    pub fn parse(raw: &[u8]) -> Result<Self, String> {
        let mut r = Reader { raw, pos: 0 };
        if r.take(8)? != MAGIC {
            return Err("not a PI3KRF02 model file".into());
        }
        let n_forests = r.u32()?;
        let mut forests = Vec::with_capacity(n_forests as usize);
        for _ in 0..n_forests {
            let n_trees = r.u32()?;
            let mut trees = Vec::with_capacity(n_trees as usize);
            for _ in 0..n_trees {
                let n_nodes = r.u32()? as usize;
                let n_leaves = r.u32()? as usize;
                let feature = r.take(n_nodes)?.to_vec();
                let payload: Vec<u32> = r
                    .take(n_nodes.checked_mul(4).ok_or("model file is corrupt")?)?
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|c| u32::from_le_bytes(*c))
                    .collect();
                let leaf_p: Vec<f64> = r
                    .take(n_leaves.checked_mul(8).ok_or("model file is corrupt")?)?
                    .as_chunks::<8>()
                    .0
                    .iter()
                    .map(|c| f64::from_le_bytes(*c))
                    .collect();
                for (i, (&f, &p)) in feature.iter().zip(&payload).enumerate() {
                    let ok = if f == LEAF {
                        (p as usize) < n_leaves
                    } else {
                        f < N_FEATURES && i + 1 < n_nodes && (p as usize) > i && (p as usize) < n_nodes
                    };
                    if !ok {
                        return Err(format!("model file has an invalid node {i}"));
                    }
                }
                if n_nodes == 0 || leaf_p.iter().any(|p| !(0.0..=1.0).contains(p)) {
                    return Err("model file has an invalid tree".into());
                }
                trees.push(Tree { feature, payload, leaf_p });
            }
            if trees.is_empty() {
                return Err("model file has an empty forest".into());
            }
            forests.push(trees);
        }
        if r.pos != raw.len() || forests.is_empty() {
            return Err("model file has trailing or missing data".into());
        }
        Ok(Self { forests })
    }

    /// Per-forest P(active), in file order.
    pub fn predict(&self, bits: u32) -> Vec<f64> {
        self.forests
            .iter()
            .map(|trees| trees.iter().map(|t| t.eval(bits)).sum::<f64>() / trees.len() as f64)
            .collect()
    }
}
