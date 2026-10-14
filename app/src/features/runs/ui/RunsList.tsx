import { useState } from "react";
import type { RunSummary } from "../../../bindings/RunSummary";
import { formatDate, pct } from "../../../shared/lib/format";
import { useDeleteRun } from "../api/runs";
import "./runs.css";

type Props = { runs: RunSummary[]; onOpen: (id: number) => void; compact?: boolean };

export function RunsList({ runs, onOpen, compact = false }: Props) {
  const del = useDeleteRun();
  const [confirming, setConfirming] = useState<number | null>(null);

  if (runs.length === 0) return <p className="muted">No runs yet.</p>;

  return (
    <ul className={`runs ${compact ? "compact" : ""}`}>
      {runs.map((r) => (
        <li key={r.id}>
          <button className="run-open" onClick={() => onOpen(r.id)}>
            <strong className="ellipsis">{r.name}</strong>
            <span className="muted">{formatDate(r.createdAt)}</span>
          </button>
          <span className="run-stats">
            <span>{r.nTotal.toLocaleString()} molecules</span>
            <span className="txt-active">{r.nActive.toLocaleString()} active</span>
            {!compact && <span>{r.nValid ? pct(r.nInDomain / r.nValid) : "-"} in domain</span>}
            {!compact && r.nValid < r.nTotal && <span className="warn">{r.nTotal - r.nValid} invalid</span>}
          </span>
          {!compact &&
            (confirming === r.id ? (
              <span className="run-actions">
                <button
                  className="btn btn-danger"
                  onClick={() => del.mutate({ runId: r.id }, { onSettled: () => setConfirming(null) })}
                >
                  Delete
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirming(r.id)} aria-label={`Delete ${r.name}`}>
                Delete
              </button>
            ))}
        </li>
      ))}
    </ul>
  );
}
