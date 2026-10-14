import type { ExportResult } from "../../../bindings/ExportResult";
import { call } from "../../../shared/lib/ipc";

export type ExportFormat = "csv" | "xlsx" | "sdf";

/** Opens a native save dialog; resolves to null when the user cancels it. */
export const exportRun = (runId: number, format: ExportFormat) =>
  call<ExportResult | null>("export_run", { runId, format });
