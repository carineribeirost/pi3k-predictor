import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Inspector } from "../../features/inspector/ui/Inspector";
import { useModelStatus, useReference } from "../../features/model/api/model";
import { useRenameRun, useRun, useRunRows, useSetThreshold } from "../../features/runs/api/runs";
import { filterRows } from "../../features/workspace/lib/filter";
import { ResultsTable } from "../../features/workspace/ui/ResultsTable";
import { RunToolbar } from "../../features/workspace/ui/RunToolbar";
import { inDomain } from "../../shared/lib/format";
import { useWorkspace } from "../../shared/lib/workspace-store";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { useThemeKey } from "../theme";

const ChartStrip = lazy(() => import("../../features/charts/ui/ChartStrip").then((m) => ({ default: m.ChartStrip })));

export function WorkspacePage() {
  const runId = Number(useParams().runId);
  const run = useRun(runId);
  const rows = useRunRows(runId);
  const ready = useModelStatus().data?.state === "ready";
  const reference = useReference(ready);
  const rename = useRenameRun();
  const saveThreshold = useSetThreshold();
  const ws = useWorkspace();
  const themeKey = useThemeKey();
  const [chartsOpen, setChartsOpen] = useState(true);
  const { resetForRun } = ws;

  useEffect(() => resetForRun(), [runId, resetForRun]);

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const threshold = ws.threshold ?? run.data?.threshold ?? 0.5;
  const filters = useMemo(
    () => ({ label: ws.label, domain: ws.domain, errorsOnly: ws.errorsOnly, search: ws.search }),
    [ws.label, ws.domain, ws.errorsOnly, ws.search],
  );
  const shown = useMemo(() => filterRows(all, filters, threshold), [all, filters, threshold]);
  const counts = useMemo(() => {
    const valid = all.filter((r) => r.prediction);
    return {
      shown: shown.length,
      valid: valid.length,
      active: valid.filter((r) => r.prediction!.mean >= threshold).length,
      inDomain: valid.filter((r) => inDomain(r.prediction!)).length,
    };
  }, [all, shown, threshold]);
  const selectedRow = all.find((r) => r.index === ws.selected) ?? shown[0];

  if (run.isError || rows.isError) {
    const e = (run.error ?? rows.error) as { message?: string } | null;
    return <div className="error-panel page-pad">Could not open this run: {e?.message ?? "unknown error"}</div>;
  }
  if (!run.data || !rows.data) return <div className="empty">Loading run…</div>;

  return (
    <div className={`workspace ${chartsOpen ? "" : "charts-closed"}`}>
      <RunToolbar
        run={run.data}
        threshold={threshold}
        counts={counts}
        onRename={(name) => rename.mutate({ runId, name })}
        onThresholdCommit={(t) => saveThreshold.mutate({ runId, threshold: t })}
        onAdd={() => ws.openAdd()}
      />
      <div className="ws-table">
        <ErrorBoundary area="results table">
          <ResultsTable rows={shown} threshold={threshold} selected={selectedRow?.index ?? null} onSelect={ws.select} />
        </ErrorBoundary>
      </div>
      <div className="ws-inspector">
        <ErrorBoundary area="inspector">
          {selectedRow && reference.data ? (
            <Inspector row={selectedRow} reference={reference.data} threshold={threshold} />
          ) : (
            <div className="empty">{reference.data ? "Select a molecule." : "Waiting for the model…"}</div>
          )}
        </ErrorBoundary>
      </div>
      <div className="ws-charts">
        <button
          className="charts-toggle btn btn-ghost"
          onClick={() => setChartsOpen((o) => !o)}
          aria-expanded={chartsOpen}
        >
          {chartsOpen ? "▾ Hide charts" : "▸ Show charts"}
        </button>
        {chartsOpen && reference.data && (
          <ErrorBoundary area="charts">
            <Suspense fallback={<div className="empty">Loading charts…</div>}>
              <ChartStrip
                rows={all}
                reference={reference.data}
                threshold={threshold}
                selected={selectedRow?.index ?? null}
                onSelect={ws.select}
                themeKey={themeKey}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
