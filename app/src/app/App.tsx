import { useEffect, useState } from "react";
import type { AppInfo } from "../bindings/AppInfo";
import { getAppInfo } from "../features/about/api/get-app-info";
import type { IpcError } from "../shared/lib/ipc";

export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [err, setErr] = useState<IpcError>();

  useEffect(() => {
    getAppInfo().then(setInfo, setErr);
  }, []);

  return (
    <main className="shell">
      <h1>PI3Kα Predictor</h1>
      {info && (
        <p>
          v{info.version} · logs: <code>{info.logDir}</code>
        </p>
      )}
      {err && (
        <p role="alert">
          {err.kind}: {err.message}
        </p>
      )}
    </main>
  );
}
