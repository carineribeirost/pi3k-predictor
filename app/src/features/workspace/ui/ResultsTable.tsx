import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MolRow } from "../../../bindings/MolRow";
import { inDomain, num } from "../../../shared/lib/format";
import { MolImage } from "../../../shared/ui/MolImage";
import { sortRows, type SortKey } from "../lib/filter";
import "./workspace.css";

type Props = {
  rows: MolRow[];
  threshold: number;
  selected: number | null;
  onSelect: (index: number) => void;
};

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "index", label: "#" },
  { key: null, label: "ID" },
  { key: null, label: "Structure" },
  { key: null, label: "SMILES" },
  { key: "p", label: "P(active)" },
  { key: null, label: "Prediction" },
  { key: "std", label: "σ" },
  { key: null, label: "Domain" },
  { key: "nn", label: "Nearest" },
];

export function ResultsTable({ rows, threshold, selected, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "index", desc: false });
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.desc), [rows, sort]);
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 56,
    overscan: 8,
  });
  const position = sorted.findIndex((r) => r.index === selected);

  useEffect(() => {
    if (position >= 0) virtual.scrollToIndex(position, { align: "auto" });
  }, [position, virtual]);

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = Math.min(
      Math.max((position < 0 ? -1 : position) + (e.key === "ArrowDown" ? 1 : -1), 0),
      sorted.length - 1,
    );
    if (sorted[next]) onSelect(sorted[next].index);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "index" }));
  }

  return (
    <div className="results" role="grid" aria-rowcount={sorted.length} aria-label="Prediction results">
      <div className="results-row results-head" role="row">
        {COLUMNS.map((c) => (
          <div
            key={c.label}
            role="columnheader"
            aria-sort={c.key && sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
          >
            {c.key ? (
              <button className="sort" onClick={() => toggleSort(c.key!)}>
                {c.label}
                {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
              </button>
            ) : (
              c.label
            )}
          </div>
        ))}
      </div>
      <div className="results-body" ref={scroller} tabIndex={0} onKeyDown={onKey}>
        {sorted.length === 0 ? (
          <div className="empty">No molecules match these filters.</div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const r = sorted[v.index];
              const p = r.prediction;
              const active = p ? p.mean >= threshold : false;
              return (
                <div
                  key={r.index}
                  role="row"
                  aria-selected={r.index === selected}
                  className={`results-row ${r.index === selected ? "selected" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                  onClick={() => onSelect(r.index)}
                >
                  <div className="muted">{r.index + 1}</div>
                  <div className="ellipsis" title={r.inputId ?? undefined}>
                    {r.inputId ?? <span className="muted">-</span>}
                  </div>
                  <div>
                    {p && r.canonical ? (
                      <MolImage smiles={r.canonical} width={84} height={48} className="mol-card" />
                    ) : null}
                  </div>
                  <div className="mono ellipsis" title={r.smiles}>
                    {r.smiles}
                  </div>
                  {p ? (
                    <>
                      <div className="pcell">
                        <div className="bar">
                          <span
                            style={{
                              width: `${p.mean * 100}%`,
                              background: active ? "var(--active)" : "var(--inactive)",
                            }}
                          />
                        </div>
                        <span>{num(p.mean)}</span>
                      </div>
                      <div>
                        <span className={`chip ${active ? "chip-active" : "chip-inactive"}`}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className={p.std > 0.15 ? "warn" : undefined}>{num(p.std)}</div>
                      <div>
                        {inDomain(p) ? (
                          <span className="chip chip-ok">Inside</span>
                        ) : (
                          <span className="chip chip-ood">⚠ Outside</span>
                        )}
                      </div>
                      <div>{num(p.analogs[0]?.similarity ?? 0)}</div>
                    </>
                  ) : (
                    <div className="row-error">
                      <span className="chip chip-error">⚠ Invalid</span> <span className="muted">{r.error}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
