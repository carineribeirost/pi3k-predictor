// @vitest-environment node
import initRDKitModule from "@rdkit/rdkit";
import { beforeAll, expect, test } from "vitest";
import { matchAll } from "./match";

let rdkit: Awaited<ReturnType<typeof initRDKitModule>>;

beforeAll(async () => {
  rdkit = await initRDKitModule();
});

test("matches, misses and invalid SMARTS each give a highlight", () => {
  const mol = rdkit.get_mol("OCCO")!;
  try {
    const [hydroxyl, nitrogen, broken] = matchAll(rdkit, mol, ["[OX2H]", "[#7]", "[[["]);
    expect(hydroxyl.atoms.sort()).toEqual([0, 3]);
    expect(nitrogen).toEqual({ atoms: [], bonds: [] });
    expect(broken).toEqual({ atoms: [], bonds: [] });
  } finally {
    mol.delete();
  }
});
