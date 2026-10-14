import type { MainModule as RDKitModule } from "@rdkit/rdkit";
import type { MolIn } from "../../../bindings/MolIn";

/** Same settings the models were trained with. */
export const MORGAN = JSON.stringify({ radius: 3, nBits: 2048 });

/** "0101…" (2048 chars, bit j at index j) to 64 u32 words; word w holds bits 32w..32w+31, lowest first. */
export function fpWords(bits: string): number[] {
  if (bits.length !== 2048) throw new Error(`expected 2048 fingerprint bits, got ${bits.length}`);
  const words = new Array<number>(64).fill(0);
  for (let j = 0; j < 2048; j++) {
    if (bits.charCodeAt(j) === 49) words[j >>> 5] |= 1 << (j & 31);
  }
  return words.map((w) => w >>> 0);
}

/**
 * Parses one SMILES (or one molblock from an SD file) and computes everything the backend
 * needs to predict and store it. A molblock is stored under its canonical SMILES.
 */
export function prepare(rdkit: RDKitModule, index: number, input: string, inputId: string | null = null): MolIn {
  const isMolblock = input.includes("\n");
  const smiles = isMolblock ? "" : input;
  const mol = rdkit.get_mol(input);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return {
      index,
      inputId,
      smiles,
      canonical: null,
      error: isMolblock ? "RDKit could not parse this molblock" : "RDKit could not parse this SMILES",
      fp: null,
      molblock: null,
      descriptors: null,
    };
  }
  try {
    const canonical = mol.get_smiles();
    return {
      index,
      inputId,
      smiles: isMolblock ? canonical : smiles,
      canonical,
      error: null,
      fp: fpWords(mol.get_morgan_fp(MORGAN)),
      molblock: mol.get_molblock(),
      descriptors: mol.get_descriptors(),
    };
  } finally {
    mol.delete();
  }
}
