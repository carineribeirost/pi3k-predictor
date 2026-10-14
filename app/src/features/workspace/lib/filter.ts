import type { MolRow } from "../../../bindings/MolRow";
import type { DomainFilter, LabelFilter } from "../../../shared/lib/workspace-store";

export type Filters = { label: LabelFilter; domain: DomainFilter; errorsOnly: boolean; search: string };
export type SortKey = "index" | "p" | "std" | "nn";

export function filterRows(rows: MolRow[], f: Filters, threshold: number): MolRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    const p = r.prediction;
    if (f.errorsOnly && !r.error) return false;
    if (f.label !== "all" && (!p || p.mean >= threshold !== (f.label === "active"))) return false;
    if (f.domain !== "all" && (!p || (p.inLeverage && p.inDistance) !== (f.domain === "in"))) return false;
    if (q && ![r.smiles, r.inputId, r.canonical].some((s) => s?.toLowerCase().includes(q))) return false;
    return true;
  });
}

const sortValue: Record<SortKey, (r: MolRow) => number> = {
  index: (r) => r.index,
  p: (r) => r.prediction?.mean ?? -1,
  std: (r) => r.prediction?.std ?? -1,
  nn: (r) => r.prediction?.analogs[0]?.similarity ?? -1,
};

export function sortRows(rows: MolRow[], key: SortKey, desc: boolean): MolRow[] {
  const v = sortValue[key];
  return [...rows].sort((a, b) => (desc ? v(b) - v(a) : v(a) - v(b)) || a.index - b.index);
}
