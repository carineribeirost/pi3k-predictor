import { expect, test } from "vitest";
import type { MolRow } from "../../../bindings/MolRow";
import { filterRows, sortRows, type Filters } from "./filter";

const row = (index: number, mean: number | null, inDomain = true, extra: Partial<MolRow> = {}): MolRow => ({
  index,
  inputId: `m${index}`,
  smiles: "CCO",
  canonical: "CCO",
  error: mean === null ? "bad" : null,
  descriptors: null,
  prediction:
    mean === null
      ? null
      : {
          bits: 0,
          probs: [mean],
          mean,
          std: index / 10,
          pca: [0, 0],
          leverage: 0,
          distance: 0,
          inLeverage: inDomain,
          inDistance: true,
          analogs: [{ trainIndex: 0, similarity: index / 10 }],
        },
  ...extra,
});

const all: Filters = { label: "all", domain: "all", errorsOnly: false, search: "" };
const rows = [row(0, 0.9), row(1, 0.2, false), row(2, null), row(3, 0.5, true, { inputId: "Target-X" })];

test("label filter uses the threshold and drops error rows", () => {
  expect(filterRows(rows, { ...all, label: "active" }, 0.5).map((r) => r.index)).toEqual([0, 3]);
  expect(filterRows(rows, { ...all, label: "inactive" }, 0.5).map((r) => r.index)).toEqual([1]);
  expect(filterRows(rows, { ...all, label: "active" }, 0.95).map((r) => r.index)).toEqual([]);
});

test("domain, errors and search filters", () => {
  expect(filterRows(rows, { ...all, domain: "out" }, 0.5).map((r) => r.index)).toEqual([1]);
  expect(filterRows(rows, { ...all, errorsOnly: true }, 0.5).map((r) => r.index)).toEqual([2]);
  expect(filterRows(rows, { ...all, search: "target" }, 0.5).map((r) => r.index)).toEqual([3]);
});

test("sorting puts error rows last when descending and keeps ties in input order", () => {
  expect(sortRows(rows, "p", true).map((r) => r.index)).toEqual([0, 3, 1, 2]);
  expect(sortRows(rows, "nn", false).map((r) => r.index)).toEqual([2, 0, 1, 3]);
});
