import { attachConsole, error } from "@tauri-apps/plugin-log";

/** Rust logs show in devtools (dev only); WebView errors land in the Rust log file. */
export async function installLogging() {
  if (import.meta.env.DEV) await attachConsole();
  window.addEventListener("error", (e) => {
    void error(`webview: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : JSON.stringify(e.reason);
    void error(`webview unhandled rejection: ${reason}`);
  });
  // CSP blocks don't reach window.onerror; log them so WASM/worker CSP gaps show up in the log file.
  document.addEventListener("securitypolicyviolation", (e) => {
    void error(`CSP blocked ${e.blockedURI || "inline"} (${e.violatedDirective})`);
  });
}
