"""Build the training-set reference the app needs: corrected applicability domain,
packed fingerprints for nearest analogs, per-bit explanations and the manifest.

Usage: uv run python export_reference.py <legacy-repo> <resources-dir> <golden.json> <parity.json>

train_fps.bin holds one 2048-bit Morgan fingerprint (radius 3) per training row as
32 little-endian u64 words; bit j sits in word j // 64 at position j % 64.
"""

import glob
import hashlib
import json
import os
import pickle
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import rdkit
import sklearn
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, rdFingerprintGenerator
from scipy.spatial.distance import cdist
from sklearn.decomposition import PCA

RDLogger.DisableLog("rdApp.*")

SELECTED = [80, 314, 350, 352, 407, 489, 523, 695, 699, 807, 875, 896, 926, 1019, 1039, 1057,
            1088, 1097, 1114, 1152, 1160, 1171, 1199, 1357, 1385, 1452, 1480, 1487, 1535, 1722, 1855, 1866]
RADIUS, NBITS, K, Z = 3, 2048, 10, 0.5

legacy_repo, res_dir, golden_path, parity_path = map(Path, sys.argv[1:5])
res_dir.mkdir(parents=True, exist_ok=True)
train = pd.read_csv(legacy_repo / "data" / "train_data_complete.csv")
mols = [Chem.MolFromSmiles(s) for s in train["canonical_smiles"]]
assert all(m is not None for m in mols), "every training SMILES must parse"

# Fingerprints: the legacy call and the generator RDKit.js uses must agree bit for bit.
gen = rdFingerprintGenerator.GetMorganGenerator(radius=RADIUS, fpSize=NBITS)
fps = np.array([gen.GetFingerprintAsNumPy(m) for m in mols], dtype=np.uint8)
legacy_fps = np.array([np.array(AllChem.GetMorganFingerprintAsBitVect(m, RADIUS, nBits=NBITS)) for m in mols], dtype=np.uint8)
assert np.array_equal(fps, legacy_fps), "MorganGenerator and GetMorganFingerprintAsBitVect disagree"

# The CSV's own bit columns cover 31 of the 32 model bits (1866 is missing).
csv_cols = [c for c in train.columns if c.isdigit()]
csv_bits_match = int((train[csv_cols].to_numpy() == fps[:, [int(c) for c in csv_cols]]).all(axis=1).sum())

x32 = fps[:, SELECTED].astype(np.float64)
pca = PCA(n_components=2).fit(x32)
scores = pca.transform(x32)
xtx_inv = np.linalg.inv(scores.T @ scores)
leverage = np.einsum("ij,jk,ik->i", scores, xtx_inv, scores)
leverage_threshold = 3 * (scores.shape[1] + 1) / len(scores)
pair = cdist(scores, scores)
distance_threshold = float(pair.mean() + Z * pair.std())
distance = np.sort(pair, axis=1)[:, :K].mean(axis=1)

packed = np.packbits(fps, axis=1, bitorder="little").view("<u8")
assert packed.shape == (len(fps), 32)
(res_dir / "train_fps.bin").write_bytes(packed.tobytes())

reference = {
    "radius": RADIUS,
    "n_bits": NBITS,
    "selected_bits": SELECTED,
    "pca_mean": pca.mean_.tolist(),
    "pca_components": pca.components_.tolist(),
    "xtx_inv": xtx_inv.tolist(),
    "leverage_threshold": leverage_threshold,
    "distance_threshold": distance_threshold,
    "k": K,
    "train": {
        "chemblId": train["molecule_chembl_id"].tolist(),
        "smiles": train["canonical_smiles"].tolist(),
        "pic50": train["standard_value"].round(4).tolist(),
        "active": train["bioactivity_class"].astype(int).tolist(),
        "pca": scores.round(6).tolist(),
        "leverage": leverage.round(8).tolist(),
        "distance": distance.round(6).tolist(),
    },
}
(res_dir / "reference.json").write_text(json.dumps(reference) + "\n", newline="\n")

# Per-bit explanation: frequent atom environments that set each model bit.
forests = []
for p in glob.glob(os.path.join(legacy_repo, "model", "*.pkl")):
    with open(p, "rb") as f:
        forests.append(pickle.load(f))
importance = np.mean([m.feature_importances_ for m in forests], axis=0)
envs = {b: Counter() for b in SELECTED}
for m in mols:
    info = {}
    AllChem.GetMorganFingerprintAsBitVect(m, RADIUS, nBits=NBITS, bitInfo=info)
    for b in SELECTED:
        for atom, rad in info.get(b, []):
            if rad == 0:
                smarts = Chem.MolFragmentToSmarts(m, atomsToUse=[atom])
            else:
                bonds = list(Chem.FindAtomEnvironmentOfRadiusN(m, rad, atom))
                atoms = sorted({a for bd in bonds for a in (m.GetBondWithIdx(bd).GetBeginAtomIdx(), m.GetBondWithIdx(bd).GetEndAtomIdx())})
                smarts = Chem.MolFragmentToSmarts(m, atomsToUse=atoms, bondsToUse=bonds)
            envs[b][smarts] += 1
active = train["bioactivity_class"].to_numpy() == 1
bits = [
    {
        "bit": b,
        "importance": float(importance[i]),
        "freqActive": float(fps[active, b].mean()),
        "freqInactive": float(fps[~active, b].mean()),
        "smarts": [s for s, _ in envs[b].most_common(3)],
    }
    for i, b in enumerate(SELECTED)
]
(res_dir / "bits.json").write_text(json.dumps(bits, indent=1) + "\n", newline="\n")

# Legacy vs corrected domain on the golden inputs.
golden = json.load(open(golden_path))["rows"]
gx = np.array([r["bits"] for r in golden], dtype=np.float64)
g_scores = pca.transform(gx)
g_lev = np.einsum("ij,jk,ik->i", g_scores, xtx_inv, g_scores)
g_dist = np.sort(cdist(g_scores, scores), axis=1)[:, :K].mean(axis=1)
legacy_pca = train[["PCA0", "PCA1"]].to_numpy()
legacy_pair = cdist(legacy_pca, legacy_pca)
legacy_distance_threshold = float(legacy_pair.mean() + Z * legacy_pair.std())
old_in = np.array([(r["leverage"] <= 0.0022) and (r["distance"] <= legacy_distance_threshold) for r in golden])
new_in = (g_lev <= leverage_threshold) & (g_dist <= distance_threshold)
src = np.array([r["source"] for r in golden])
parity = {
    "csv_rows": len(train),
    "csv_bits_match_rows": csv_bits_match,
    "legacy_distance_threshold": legacy_distance_threshold,
    "corrected_distance_threshold": distance_threshold,
    "legacy_leverage_threshold": 0.0022,
    "corrected_leverage_threshold": leverage_threshold,
    "train_inside_corrected": int(((leverage <= leverage_threshold) & (distance <= distance_threshold)).sum()),
    "golden": {
        s: {
            "n": int((src == s).sum()),
            "inside_legacy": int(old_in[src == s].sum()),
            "inside_corrected": int(new_in[src == s].sum()),
            "verdict_changed": int((old_in != new_in)[src == s].sum()),
            "max_abs_pca_diff": float(np.abs(g_scores - np.array([r["pca"] for r in golden]))[src == s].max()),
        }
        for s in ("example", "train")
    },
}
Path(parity_path).write_text(json.dumps(parity, indent=1) + "\n", newline="\n")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


manifest = {
    "model_version": "1.0.0",
    "rdkit": rdkit.__version__,
    "sklearn": sklearn.__version__,
    "resources": {p.name: sha256(p) for p in sorted(res_dir.iterdir()) if p.name != "model_manifest.json"},
    "sources": {
        **{f"model/{Path(p).name}": sha256(p) for p in sorted(glob.glob(os.path.join(legacy_repo, "model", "*.pkl")))},
        "data/train_data_complete.csv": sha256(legacy_repo / "data" / "train_data_complete.csv"),
    },
}
(res_dir / "model_manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", newline="\n")
print(json.dumps(parity, indent=1))
