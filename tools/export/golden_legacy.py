"""Run the legacy Streamlit pipeline unchanged and record its outputs as test fixtures.

Usage: uv run --all-groups python golden_legacy.py <legacy-repo> <out.json>
"""

import glob
import json
import os
import random
import sys
import types
from pathlib import Path

import numpy as np
import pandas as pd

legacy_repo = Path(sys.argv[1]).resolve()
out_path = Path(sys.argv[2]).resolve()

# The legacy modules read data/ and model/ relative to the working directory.
os.chdir(legacy_repo)
sys.path.insert(0, str(legacy_repo))
# Leave the legacy checkout untouched (no __pycache__ files).
sys.dont_write_bytecode = True
# The package __init__ imports its Streamlit display helper; the pipeline never calls it.
sys.modules["streamlit"] = types.ModuleType("streamlit")

from pi3k_predictor.applicability_domain import ApplicabilityDomain  # noqa: E402
from pi3k_predictor.fingerprint_generator import FingerprintGenerator  # noqa: E402
from pi3k_predictor.predictor import Predictor  # noqa: E402

example = [line.strip() for line in open("data/example_data.txt") if line.strip()]
train = pd.read_csv("data/train_data_complete.csv")["canonical_smiles"].tolist()
sample = random.Random(0).sample(train, 500)
smiles = example + sample

fp_generator = FingerprintGenerator(radius=3, n_bits=2048)
predictor = Predictor(model_directory="model", threshold=0.5)
# Same call Predictor.load_models uses, so model_order matches predictor.models.
model_order = [Path(p).name for p in glob.glob(os.path.join("model", "*.pkl"))]
assert len(model_order) == len(predictor.models) == 10

df = pd.DataFrame({"SMILES": smiles})
descriptors, kept = fp_generator.generate_descriptors(df, smiles_column="SMILES")
assert kept == list(range(len(smiles))), "golden inputs must all parse"

mean_prob, _ = predictor.predict(descriptors)
per_forest = np.array([m.predict_proba(descriptors)[:, 1] for m in predictor.models]).T

ad = ApplicabilityDomain()
metrics = ad.calculate_user_data_metrics(descriptors)

rows = []
for i, smi in enumerate(smiles):
    rows.append(
        {
            "smiles": smi,
            "source": "example" if i < len(example) else "train",
            "bits": [int(b) for b in descriptors.iloc[i].tolist()],
            "probs": [float(p) for p in per_forest[i]],
            "mean": float(mean_prob[i]),
            "pca": [float(metrics["PCA0"][i]), float(metrics["PCA1"][i])],
            "leverage": float(metrics["leverage"][i]),
            "distance": float(metrics["distance"][i]),
        }
    )

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(
    json.dumps(
        {
            "selected_bits": [int(c) for c in descriptors.columns],
            "model_order": model_order,
            "rows": rows,
        },
        indent=1,
    )
    + "\n",
    newline="\n",
)
print(f"wrote {len(rows)} rows to {out_path}")
