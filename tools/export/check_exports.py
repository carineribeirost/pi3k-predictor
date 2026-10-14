"""Check that a run exported as CSV, Excel and SD file reads back cleanly and consistently.

Usage: uv run python check_exports.py <run.csv> <run.xlsx> <run.sdf>
"""

import sys

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")
csv_path, xlsx_path, sdf_path = sys.argv[1:4]
problems = []

csv = pd.read_csv(csv_path, keep_default_na=False, na_values=[""])
xlsx = pd.read_excel(xlsx_path, sheet_name="Results", keep_default_na=False, na_values=[""])
info = pd.read_excel(xlsx_path, sheet_name="Run info", header=None)

if list(csv.columns) != list(xlsx.columns):
    problems.append("CSV and Excel columns differ")
if len(csv) != len(xlsx):
    problems.append(f"CSV has {len(csv)} rows, Excel has {len(xlsx)}")
for col in csv.columns:
    a, b = csv[col], xlsx[col]
    if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
        if not np.allclose(a.to_numpy(float), b.to_numpy(float), equal_nan=True, rtol=0, atol=1e-12):
            problems.append(f"column {col} differs between CSV and Excel")
    elif not a.astype(str).equals(b.astype(str)):
        problems.append(f"column {col} differs between CSV and Excel")

ok = csv[csv["status"] == "ok"]
bad = csv[csv["status"] == "invalid"]
if not ok["p_active"].between(0, 1).all():
    problems.append("p_active outside [0, 1]")
if not set(ok["prediction"]) <= {"active", "inactive"}:
    problems.append("unexpected prediction labels")
if bad["p_active"].notna().any():
    problems.append("invalid rows carry predictions")
if list(csv["row"]) != list(range(1, len(csv) + 1)):
    problems.append("rows are not in input order")

mols = [m for m in Chem.SDMolSupplier(sdf_path)]
if any(m is None for m in mols):
    problems.append(f"{sum(m is None for m in mols)} SD records failed to parse")
mols = [m for m in mols if m is not None]
if len(mols) != len(ok):
    problems.append(f"SD file has {len(mols)} records, CSV has {len(ok)} predicted rows")
by_row = ok.set_index("row")
for m in mols:
    row = int(m.GetProp("row"))
    expected = by_row.loc[row]
    if abs(float(m.GetProp("p_active")) - expected["p_active"]) > 1e-12:
        problems.append(f"row {row}: p_active differs between SD file and CSV")
    if Chem.MolToSmiles(m) != expected["canonical_smiles"]:
        problems.append(f"row {row}: structure in SD file does not match canonical_smiles")

print(f"CSV: {len(csv)} rows ({len(ok)} predicted, {len(bad)} invalid), {len(csv.columns)} columns")
print(f"Excel: Results {xlsx.shape}, Run info {len(info)} entries")
print(f"SD file: {len(mols)} records")
if problems:
    print("PROBLEMS:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("All three exports agree.")
