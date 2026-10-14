import { lazy, Suspense } from "react";
import { useNavigate } from "react-router";
import { useModelStatus, useReference } from "../../features/model/api/model";
import { useRuns } from "../../features/runs/api/runs";
import { RunsList } from "../../features/runs/ui/RunsList";
import { useWorkspace } from "../../shared/lib/workspace-store";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { useThemeKey } from "../theme";

const MolstarView = lazy(() =>
  import("../../features/target/ui/MolstarView").then((m) => ({ default: m.MolstarView })),
);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WelcomePage() {
  const navigate = useNavigate();
  const themeKey = useThemeKey();
  const openAdd = useWorkspace((s) => s.openAdd);
  const runs = useRuns();
  const ready = useModelStatus().data?.state === "ready";
  const reference = useReference(ready);
  const ref = reference.data;
  const actives = ref?.train.active.filter(Boolean).length ?? 0;

  return (
    <div className="page welcome">
      <div className="hero-row">
        <section className="hero">
          <p className="label">PI3Kα activity predictor</p>
          <h1>Triage molecules against PI3Kα, with the evidence next to every call.</h1>
          <p className="muted">
            An ensemble of {ref?.forests ?? 10} random forests trained on ChEMBL bioactivity data predicts whether a
            molecule inhibits the PI3Kα kinase. Each prediction comes with model agreement, an applicability-domain
            check and the closest training compounds.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => openAdd("paste")} disabled={!ready}>
              New prediction
            </button>
            <button className="btn" onClick={() => openAdd("example")} disabled={!ready}>
              Try the example set
            </button>
            {!ready && <span className="muted">Loading the model…</span>}
          </div>
        </section>
        <div className="hero-structure panel">
          <div className="hero-viewer">
            <ErrorBoundary area="3D preview">
              <Suspense fallback={<div className="empty">Loading structure…</div>}>
                <MolstarView
                  preset="overview"
                  spin={!reducedMotion}
                  themeKey={themeKey}
                  label="PI3Kα structure, PDB 4JPS"
                />
              </Suspense>
            </ErrorBoundary>
          </div>
          <div className="hero-caption">
            <span className="muted">PI3Kα with alpelisib, PDB 4JPS</span>
            <button className="btn btn-ghost" onClick={() => navigate("/target")}>
              Explore the structure →
            </button>
          </div>
        </div>
      </div>

      <div className="welcome-grid">
        <section>
          <h2 className="label">Recent runs</h2>
          {runs.data ? (
            <RunsList runs={runs.data.slice(0, 5)} onOpen={(id) => navigate(`/runs/${id}`)} compact />
          ) : null}
        </section>
        <section className="panel model-card">
          <h2 className="label">Model</h2>
          {ref ? (
            <dl>
              <div>
                <dt>Version</dt>
                <dd>{ref.modelVersion}</dd>
              </div>
              <div>
                <dt>Training compounds</dt>
                <dd>
                  {ref.train.smiles.length.toLocaleString()} ({actives.toLocaleString()} active,{" "}
                  {(ref.train.smiles.length - actives).toLocaleString()} inactive)
                </dd>
              </div>
              <div>
                <dt>Input</dt>
                <dd>32 bits of a Morgan fingerprint (radius 3, 2048 bits)</dd>
              </div>
              <div>
                <dt>Applicability domain</dt>
                <dd>
                  leverage ≤ {ref.leverageThreshold.toFixed(4)} and mean distance to {ref.k} nearest ≤{" "}
                  {ref.distanceThreshold.toFixed(3)} in PCA space
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </section>
      </div>
    </div>
  );
}
