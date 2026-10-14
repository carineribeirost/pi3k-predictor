"""Convert the legacy RandomForest pickles into the compact binary the app evaluates.

Usage: uv run python export_models.py <legacy-repo> <out.bin.zst> <streamlit_predictions.json>

Layout (little-endian), zstd-compressed:
    b"PI3KRF02"
    u32 n_forests
    per forest: u32 n_trees
      per tree: u32 n_nodes, u32 n_leaves
                u8  feature[n_nodes]   input index 0..31, 255 for a leaf
                u32 payload[n_nodes]   internal: right child; leaf: index into leaf_p
                f64 leaf_p[n_leaves]   P(active) at that leaf
The left child of node i is always i + 1, and a set bit goes right.
"""

import glob
import json
import os
import pickle
import struct
import sys

import numpy as np
import zstandard

LEAF = 255
MAGIC = b"PI3KRF02"

legacy_repo, out_path, predictions_path = sys.argv[1:4]
paths = glob.glob(os.path.join(legacy_repo, "model", "*.pkl"))
forests = []
for p in paths:
    with open(p, "rb") as f:
        forests.append(pickle.load(f))
assert all(list(m.classes_) == [0, 1] for m in forests)


def encode_tree(tree):
    n = tree.node_count
    left, right = tree.children_left, tree.children_right
    is_leaf = left == -1
    assert np.all(tree.threshold[~is_leaf] == 0.5), "features are binary; every split must be at 0.5"
    assert np.all(left[~is_leaf] == np.arange(n)[~is_leaf] + 1), "left child must follow its parent"
    feature = np.where(is_leaf, LEAF, tree.feature).astype(np.uint8)
    counts = tree.value[:, 0, :]
    leaf_ids = np.flatnonzero(is_leaf)
    leaf_p = (counts[leaf_ids, 1] / counts[leaf_ids].sum(axis=1)).astype("<f8")
    payload = right.astype(np.int64)
    payload[leaf_ids] = np.arange(len(leaf_ids))
    return feature, payload.astype("<u4"), leaf_p


encoded = [[encode_tree(est.tree_) for est in m.estimators_] for m in forests]

buf = bytearray(MAGIC)
buf += struct.pack("<I", len(encoded))
for trees in encoded:
    buf += struct.pack("<I", len(trees))
    for feature, payload, leaf_p in trees:
        buf += struct.pack("<II", len(feature), len(leaf_p))
        buf += feature.tobytes() + payload.tobytes() + leaf_p.tobytes()


def decode(raw):
    """Independent reader used to check the bytes, not the in-memory arrays."""
    off = 8
    assert raw[:8] == MAGIC
    (nf,) = struct.unpack_from("<I", raw, off)
    off += 4
    out = []
    for _ in range(nf):
        (nt,) = struct.unpack_from("<I", raw, off)
        off += 4
        trees = []
        for _ in range(nt):
            nn, nl = struct.unpack_from("<II", raw, off)
            off += 8
            feat = np.frombuffer(raw, np.uint8, nn, off)
            off += nn
            pay = np.frombuffer(raw, "<u4", nn, off)
            off += 4 * nn
            lp = np.frombuffer(raw, "<f8", nl, off)
            off += 8 * nl
            trees.append((feat, pay, lp))
        out.append(trees)
    assert off == len(raw)
    return out


def forest_proba(trees, x):
    total = 0.0
    for feat, pay, lp in trees:
        i = 0
        while feat[i] != LEAF:
            i = int(pay[i]) if x[feat[i]] else i + 1
        total += lp[pay[i]]
    return total / len(trees)


decoded = decode(bytes(buf))
captured = json.load(open(predictions_path))
rng = np.random.default_rng(0)
inputs = np.vstack([np.array([r["bits"] for r in captured["rows"]]), rng.integers(0, 2, size=(300, 32))])
expected = np.array([m.predict_proba(inputs)[:, 1] for m in forests]).T
got = np.array([[forest_proba(t, x) for t in decoded] for x in inputs])
max_err = float(np.abs(got - expected).max())
assert max_err < 1e-12, f"round trip mismatch {max_err}"

compressed = zstandard.ZstdCompressor(level=19).compress(bytes(buf))
os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
with open(out_path, "wb") as f:
    f.write(compressed)

print(
    json.dumps(
        {
            "model_order": [os.path.basename(p) for p in paths],
            "trees": [len(t) for t in encoded],
            "nodes": int(sum(len(f) for t in encoded for f, _, _ in t)),
            "raw_bytes": len(buf),
            "compressed_bytes": len(compressed),
            "checked_inputs": len(inputs),
            "max_abs_error": max_err,
        }
    )
)
