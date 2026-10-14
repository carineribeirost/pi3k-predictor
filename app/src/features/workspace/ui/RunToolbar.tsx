import { useState } from "react";
import type { RunSummary } from "../../../bindings/RunSummary";
import { useWorkspace, type DomainFilter, type LabelFilter } from "../../../shared/lib/workspace-store";

type Props = {
  run: RunSummary;
  threshold: number;
  counts: { shown: number; valid: number; active: number; inDomain: number };
  onThresholdCommit: (t: number) => void;
  onRename: (name: string) => void;
  onAdd: () => void;
  onExport: (format: "csv" | "xlsx" | "sdf") => void;
  exporting: boolean;
};

export function RunToolbar({ run, threshold, counts, onThresholdCommit, onRename, onAdd, onExport, exporting }: Props) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(run.name);

  function commitName() {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== run.name) onRename(name);
    else setDraft(run.name);
  }

  return (
    <div className="toolbar">
      <h1 className="run-name">
        {editing ? (
          <input
            className="input"
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setDraft(run.name);
                setEditing(false);
              }
            }}
            aria-label="Run name"
          />
        ) : (
          <button className="btn btn-ghost" onClick={() => setEditing(true)} title="Rename run">
            {run.name} <span className="muted">✎</span>
          </button>
        )}
      </h1>

      <div className="stats" aria-live="polite">
        <span>
          <strong>{counts.valid}</strong> predicted
        </span>
        <span>
          <strong>{counts.active}</strong> active
        </span>
        <span>
          <strong>{counts.inDomain}</strong> in domain
        </span>
        {counts.shown !== run.nTotal && <span>{counts.shown} shown</span>}
      </div>

      <label className="threshold">
        <span className="label">Threshold</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => ws.setThreshold(Number(e.target.value))}
          onPointerUp={(e) => onThresholdCommit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onThresholdCommit(Number((e.target as HTMLInputElement).value))}
        />
        <span className="mono">{threshold.toFixed(2)}</span>
      </label>

      <div className="segmented" role="group" aria-label="Prediction filter">
        {(["all", "active", "inactive"] as LabelFilter[]).map((l) => (
          <button key={l} aria-pressed={ws.label === l} onClick={() => ws.setLabel(l)}>
            {l === "all" ? "All" : l === "active" ? "Actives" : "Inactives"}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Domain filter">
        {(["all", "in", "out"] as DomainFilter[]).map((d) => (
          <button key={d} aria-pressed={ws.domain === d} onClick={() => ws.setDomain(d)}>
            {d === "all" ? "Any domain" : d === "in" ? "Inside" : "Outside"}
          </button>
        ))}
      </div>
      <div className="segmented">
        <button aria-pressed={ws.errorsOnly} onClick={() => ws.setErrorsOnly(!ws.errorsOnly)}>
          Errors only
        </button>
      </div>
      <input
        className="input search"
        type="search"
        placeholder="Search ID or SMILES"
        value={ws.search}
        onChange={(e) => ws.setSearch(e.target.value)}
        aria-label="Search"
      />
      <div className="segmented" role="group" aria-label="Export run">
        {(
          [
            ["csv", "CSV"],
            ["xlsx", "Excel"],
            ["sdf", "SDF"],
          ] as const
        ).map(([f, label]) => (
          <button key={f} onClick={() => onExport(f)} disabled={exporting} title={`Export as ${label}`}>
            ↓ {label}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" onClick={onAdd}>
        + New prediction
      </button>
    </div>
  );
}
