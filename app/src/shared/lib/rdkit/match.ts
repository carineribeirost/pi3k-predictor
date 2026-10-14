import type { MainModule as RDKitModule, Mol } from "@rdkit/rdkit";
import type { Highlight } from "./protocol";

/** Atoms and bonds of `mol` matched by each SMARTS, merged over all matches. */
export function matchAll(rdkit: RDKitModule, mol: Mol, smarts: string[]): Highlight[] {
  return smarts.map((s) => {
    const query = rdkit.get_qmol(s);
    if (!query) return { atoms: [], bonds: [] };
    try {
      // RDKit.js returns "{}" rather than "[]" when nothing matches.
      const parsed: unknown = JSON.parse(mol.get_substruct_matches(query) || "[]");
      const found = Array.isArray(parsed) ? (parsed as Highlight[]) : [];
      const atoms = new Set<number>();
      const bonds = new Set<number>();
      for (const m of found) {
        m.atoms?.forEach((a) => atoms.add(a));
        m.bonds?.forEach((b) => bonds.add(b));
      }
      return { atoms: [...atoms], bonds: [...bonds] };
    } finally {
      query.delete();
    }
  });
}
