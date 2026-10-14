import { useEffect, useState } from "react";
import type { AppInfo } from "../../bindings/AppInfo";
import { getAppInfo } from "../../features/about/api/get-app-info";
import { useModelStatus, useReference } from "../../features/model/api/model";
import { UpdatePanel } from "../../features/updates/ui/UpdatePanel";
import { useWorkspace, type Theme } from "../../shared/lib/workspace-store";

const LICENSES = [
  ["RDKit", "BSD-3-Clause"],
  ["Apache ECharts", "Apache-2.0"],
  ["React", "MIT"],
  ["Tauri", "Apache-2.0 / MIT"],
  ["ChEMBL data", "CC BY-SA 3.0"],
];

export function SettingsPage() {
  const { theme, setTheme } = useWorkspace();
  const [info, setInfo] = useState<AppInfo>();
  const ready = useModelStatus().data?.state === "ready";
  const reference = useReference(ready);

  useEffect(() => {
    getAppInfo().then(setInfo, () => setInfo(undefined));
  }, []);

  return (
    <div className="page settings">
      <h1>Settings</h1>
      <section className="panel">
        <h2 className="label">Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t === "system" ? "Follow system" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2 className="label">Updates</h2>
        <UpdatePanel />
      </section>
      <section className="panel">
        <h2 className="label">About</h2>
        <dl>
          <div>
            <dt>App version</dt>
            <dd>{info?.version ?? "…"}</dd>
          </div>
          <div>
            <dt>Model version</dt>
            <dd>{reference.data?.modelVersion ?? "…"}</dd>
          </div>
          <div>
            <dt>Log folder</dt>
            <dd className="mono">{info?.logDir ?? "…"}</dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2 className="label">Open-source components</h2>
        <dl>
          {LICENSES.map(([name, license]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{license}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
