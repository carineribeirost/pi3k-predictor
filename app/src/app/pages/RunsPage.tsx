import { useNavigate } from "react-router";
import { useRuns } from "../../features/runs/api/runs";
import { RunsList } from "../../features/runs/ui/RunsList";
import { useWorkspace } from "../../shared/lib/workspace-store";

export function RunsPage() {
  const runs = useRuns();
  const navigate = useNavigate();
  const openAdd = useWorkspace((s) => s.openAdd);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Runs</h1>
        <button className="btn btn-primary" onClick={() => openAdd()}>
          + New prediction
        </button>
      </div>
      {runs.isError ? (
        <div className="error-panel">Could not load runs.</div>
      ) : runs.data ? (
        <RunsList runs={runs.data} onOpen={(id) => navigate(`/runs/${id}`)} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
