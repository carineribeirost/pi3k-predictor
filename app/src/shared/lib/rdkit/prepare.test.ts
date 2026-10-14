// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import initRDKitModule from "@rdkit/rdkit";
import { beforeAll, expect, test } from "vitest";
import { fpWords, prepare } from "./prepare";

const resources = new URL("../../../../src-tauri/resources/", import.meta.url);
let rdkit: Awaited<ReturnType<typeof initRDKitModule>>;

beforeAll(async () => {
  rdkit = await initRDKitModule();
});

test("fpWords packs bit j into word j/32 at position j%32", () => {
  const bits = Array.from({ length: 2048 }, (_, j) => (j === 0 || j === 33 || j === 2047 ? "1" : "0")).join("");
  const words = fpWords(bits);
  expect(words[0]).toBe(1);
  expect(words[1]).toBe(2);
  expect(words[63]).toBe(0x80000000);
});

test("invalid SMILES becomes an error row without a fingerprint", () => {
  const row = prepare(rdkit, 3, "C1CC(", "x");
  expect(row).toMatchObject({ index: 3, inputId: "x", fp: null, canonical: null });
  expect(row.error).toBeTruthy();
});

test("RDKit.js fingerprints match the Python training fingerprints bit for bit", () => {
  const reference = JSON.parse(readFileSync(new URL("reference.json", resources), "utf8"));
  const smiles: string[] = reference.train.smiles;
  const packed = readFileSync(new URL("train_fps.bin", resources));
  const expected = new Uint32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4);
  expect(expected.length).toBe(smiles.length * 64);

  const mismatched: number[] = [];
  smiles.forEach((s, i) => {
    const row = prepare(rdkit, i, s);
    expect(row.error).toBeNull();
    const got = row.fp!;
    for (let w = 0; w < 64; w++) {
      if (got[w] !== expected[i * 64 + w]) {
        mismatched.push(i);
        break;
      }
    }
  });
  expect(mismatched).toEqual([]);
}, 300_000);

test("a molblock is stored under its canonical SMILES", () => {
  const molblock =
    "ethanol\n  RDKit          2D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    2.5981   -0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  0\n  2  3  1  0\nM  END";
  const row = prepare(rdkit, 0, molblock, "ethanol");
  expect(row).toMatchObject({ smiles: "CCO", canonical: "CCO", error: null, inputId: "ethanol" });
  expect(prepare(rdkit, 1, "junk\n\nM  END").error).toMatch(/molblock/);
});
