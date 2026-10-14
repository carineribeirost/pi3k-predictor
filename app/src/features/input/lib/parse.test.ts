import { expect, test } from "vitest";
import { guessColumns, parseCsv, parseLines, splitSdf, tableEntries } from "./parse";

test("parseLines keeps names, skips blanks and comments, handles CRLF", () => {
  expect(parseLines("CCO ethanol\r\n\r\n# note\nc1ccccc1\n")).toEqual([
    { smiles: "CCO", inputId: "ethanol" },
    { smiles: "c1ccccc1", inputId: null },
  ]);
});

test("parseCsv handles quotes, escaped quotes, semicolons and CRLF", () => {
  const t = parseCsv('id;SMILES\r\n"a;1";CCO\r\n"say ""hi""";c1ccccc1\r\n');
  expect(t.header).toEqual(["id", "SMILES"]);
  expect(t.rows).toEqual([
    ["a;1", "CCO"],
    ['say "hi"', "c1ccccc1"],
  ]);
});

test("guessColumns finds SMILES and ID columns", () => {
  expect(guessColumns(["Compound_ID", "pIC50", "canonical_smiles"])).toEqual({ smiles: 2, id: 0 });
  expect(guessColumns(["structure", "value"])).toEqual({ smiles: 0, id: null });
});

test("tableEntries drops rows without SMILES", () => {
  const t = {
    header: ["s", "id"],
    rows: [
      ["CCO", "x"],
      ["", "y"],
      ["CC", ""],
    ],
  };
  expect(tableEntries(t, 0, 1)).toEqual([
    { smiles: "CCO", inputId: "x" },
    { smiles: "CC", inputId: null },
  ]);
});

test("splitSdf returns each molblock with its title", () => {
  const block = (title: string) =>
    `${title}\n  RDKit          2D\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\nM  END\n`;
  const sdf = `${block("first")}> <pIC50>\n7.1\n\n$$$$\n${block("")}$$$$\n`;
  const out = splitSdf(sdf);
  expect(out).toHaveLength(2);
  expect(out[0].title).toBe("first");
  expect(out[0].molblock.endsWith("M  END")).toBe(true);
  expect(out[1].title).toBeNull();
});
