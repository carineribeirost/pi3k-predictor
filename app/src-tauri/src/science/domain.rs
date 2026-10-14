//! Applicability domain in the 2-component PCA space of the 32 model bits:
//! leverage h = xᵀ(TᵀT)⁻¹x and the mean distance to the k nearest training points.

pub struct Domain {
    pub mean: [f64; 32],
    pub components: [[f64; 32]; 2],
    pub xtx_inv: [[f64; 2]; 2],
    pub leverage_threshold: f64,
    pub distance_threshold: f64,
    pub k: usize,
    pub train: Vec<[f64; 2]>,
}

impl Domain {
    pub fn project(&self, bits: u32) -> [f64; 2] {
        let mut out = [0.0; 2];
        for (o, comp) in out.iter_mut().zip(&self.components) {
            *o = (0..32).map(|i| (f64::from(bits >> i & 1) - self.mean[i]) * comp[i]).sum();
        }
        out
    }

    pub fn leverage(&self, p: [f64; 2]) -> f64 {
        let m = &self.xtx_inv;
        p[0] * (m[0][0] * p[0] + m[0][1] * p[1]) + p[1] * (m[1][0] * p[0] + m[1][1] * p[1])
    }

    /// Mean Euclidean distance to the k nearest training points.
    pub fn knn_distance(&self, p: [f64; 2]) -> f64 {
        let mut d: Vec<f64> = self.train.iter().map(|t| (t[0] - p[0]).hypot(t[1] - p[1])).collect();
        let k = self.k.min(d.len());
        d.select_nth_unstable_by(k - 1, f64::total_cmp);
        d[..k].iter().sum::<f64>() / k as f64
    }
}
