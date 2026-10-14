import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { AddMolecules } from "../features/input/ui/AddMolecules";
import { useModelStatus } from "../features/model/api/model";
import { useWorkspace } from "../shared/lib/workspace-store";
import { ErrorBoundary } from "../shared/ui/ErrorBoundary";
import { DEFAULT_THRESHOLD } from "./constants";
import { useApplyTheme } from "./theme";

const NAV = [
  { to: "/", label: "Home", icon: "M3 11 12 3l9 8v10h-6v-6H9v6H3z" },
  { to: "/runs", label: "Runs", icon: "M4 5h16M4 12h16M4 19h16" },
  {
    to: "/target",
    label: "Target",
    icon: "M12 3c-3 3-3 6 0 9s3 6 0 9M12 3c3 3 3 6 0 9s-3 6 0 9M7 6h10M7 18h10M8.5 9.5h7M8.5 14.5h7",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  },
];

export function Shell() {
  useApplyTheme();
  const status = useModelStatus();
  const { adding, closeAdd } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = status.data?.state ?? "loading";

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand" title="PI3Kα Predictor">
          PI3K<span>α</span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className="rail-link">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={n.icon} />
            </svg>
            <span>{n.label}</span>
          </NavLink>
        ))}
        <span
          className={`model-dot ${state}`}
          title={state === "ready" ? "Model ready" : state === "loading" ? "Model loading" : "Model failed to load"}
        />
      </nav>
      <main className="main">
        {state === "failed" && status.data?.state === "failed" && (
          <div className="error-panel banner" role="alert">
            The prediction model could not be loaded: {status.data.error}
          </div>
        )}
        <ErrorBoundary area="page">
          <Outlet />
        </ErrorBoundary>
      </main>
      <ErrorBoundary area="new-prediction dialog">
        <AddMolecules
          open={adding !== null}
          initialTab={adding ?? "paste"}
          threshold={DEFAULT_THRESHOLD}
          onClose={closeAdd}
          onDone={(runId) => {
            closeAdd();
            void qc.invalidateQueries({ queryKey: ["runs"] });
            navigate(`/runs/${runId}`);
          }}
        />
      </ErrorBoundary>
    </div>
  );
}
