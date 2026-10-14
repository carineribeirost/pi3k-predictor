//! Nearest training analogs by Tanimoto similarity on 2048-bit fingerprints.

pub type Fingerprint = [u64; 32];

pub fn tanimoto(a: &Fingerprint, b: &Fingerprint) -> f64 {
    let (mut both, mut any) = (0u32, 0u32);
    for (x, y) in a.iter().zip(b) {
        both += (x & y).count_ones();
        any += (x | y).count_ones();
    }
    if any == 0 { 0.0 } else { f64::from(both) / f64::from(any) }
}

/// The k most similar training rows as (row index, similarity), most similar first.
pub fn top_k(train: &[Fingerprint], query: &Fingerprint, k: usize) -> Vec<(u32, f64)> {
    let mut scored: Vec<(u32, f64)> = train.iter().enumerate().map(|(i, t)| (i as u32, tanimoto(query, t))).collect();
    let k = k.min(scored.len());
    if k == 0 {
        return Vec::new();
    }
    scored.select_nth_unstable_by(k - 1, |a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    scored.truncate(k);
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tanimoto_counts_shared_bits() {
        let mut a = [0u64; 32];
        let mut b = [0u64; 32];
        a[0] = 0b1110;
        b[0] = 0b0111;
        assert_eq!(tanimoto(&a, &b), 2.0 / 4.0);
        assert_eq!(tanimoto(&[0; 32], &[0; 32]), 0.0);
    }

    #[test]
    fn top_k_orders_by_similarity_then_index() {
        let q = [u64::MAX; 32];
        let mut half = [0u64; 32];
        half[..16].fill(u64::MAX);
        let train = vec![[0; 32], half, q, half];
        assert_eq!(top_k(&train, &q, 3), vec![(2, 1.0), (1, 0.5), (3, 0.5)]);
    }
}
