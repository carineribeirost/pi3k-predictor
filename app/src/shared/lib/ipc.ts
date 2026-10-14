import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { info, warn } from "@tauri-apps/plugin-log";
import type { AppError } from "../../bindings/AppError";

/** AppError from Rust, or `ipc` when Tauri itself rejected (unknown command, missing permission). */
export type IpcError = AppError | { kind: "ipc"; message: string };

function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** The only place that calls `invoke`. Features wrap it in `features/<x>/api/`. Every failure is logged here. */
export async function call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const start = performance.now();
  try {
    const result = await invoke<T>(cmd, args);
    if (import.meta.env.DEV) void info(`ipc ${cmd} ok in ${Math.round(performance.now() - start)} ms`);
    return result;
  } catch (e) {
    const err: IpcError = isAppError(e) ? e : { kind: "ipc", message: String(e) };
    void warn(`ipc ${cmd} failed: ${err.kind}: ${err.message}`);
    throw err;
  }
}
