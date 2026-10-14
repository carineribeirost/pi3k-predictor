import { useState } from "react";
import { checkForUpdate, installAndRestart, type Download, type Update } from "../api/updates";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; update: Update; progress: Download }
  | { kind: "error"; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export function UpdatePanel() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function runCheck() {
    setState({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      setState(update ? { kind: "available", update } : { kind: "current" });
    } catch (e) {
      setState({ kind: "error", message: `Could not check for updates: ${message(e)}` });
    }
  }

  async function install(update: Update) {
    setState({ kind: "installing", update, progress: { done: 0, total: null } });
    try {
      await installAndRestart(update, (progress) => setState({ kind: "installing", update, progress }));
    } catch (e) {
      setState({ kind: "error", message: `The update failed: ${message(e)}` });
    }
  }

  return (
    <div className="update-panel">
      {state.kind !== "available" && state.kind !== "installing" && (
        <button className="btn" onClick={() => void runCheck()} disabled={state.kind === "checking"}>
          {state.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
      {state.kind === "current" && <p className="muted">You have the latest version.</p>}
      {state.kind === "error" && <p className="warn">{state.message}</p>}
      {(state.kind === "available" || state.kind === "installing") && (
        <>
          <p>
            Version <strong>{state.update.version}</strong> is available (you have {state.update.currentVersion}).
          </p>
          {state.update.body && <p className="release-notes">{state.update.body}</p>}
          {state.kind === "available" ? (
            <button className="btn btn-primary" onClick={() => void install(state.update)}>
              Install and restart
            </button>
          ) : (
            <div className="add-progress" aria-live="polite">
              <div className="bar">
                <span
                  style={{
                    width: state.progress.total ? `${(100 * state.progress.done) / state.progress.total}%` : "100%",
                  }}
                />
              </div>
              <span className="muted">
                Downloading {mb(state.progress.done)}
                {state.progress.total ? ` of ${mb(state.progress.total)}` : ""}…
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
