import type { MolIn } from "../../../bindings/MolIn";
import type { MolRow } from "../../../bindings/MolRow";
import { call } from "../../../shared/lib/ipc";
import { rdkit } from "../../../shared/lib/rdkit/client";
import type { PrepareItem } from "../../../shared/lib/rdkit/protocol";

export type InputKind = "paste" | "file" | "sketch" | "example";
export type Progress = { done: number; total: number };

const CHUNK = 500;

const createRun = (name: string, threshold: number, inputKind: InputKind) =>
  call<number>("create_run", { name, threshold, inputKind });

const predictChunk = (runId: number, molecules: MolIn[]) => call<MolRow[]>("predict_chunk", { runId, molecules });

export const predictOne = (molecule: MolIn) => call<MolRow>("predict_one", { molecule });

/** Fingerprints the inputs in the worker and predicts them chunk by chunk under a new run. */
export async function runPrediction(opts: {
  name: string;
  threshold: number;
  inputKind: InputKind;
  items: PrepareItem[];
  onProgress: (p: Progress) => void;
}): Promise<number> {
  const runId = await createRun(opts.name, opts.threshold, opts.inputKind);
  const total = opts.items.length;
  opts.onProgress({ done: 0, total });
  for (let i = 0; i < total; i += CHUNK) {
    const molecules = await rdkit.prepare(opts.items.slice(i, i + CHUNK));
    await predictChunk(runId, molecules);
    opts.onProgress({ done: Math.min(i + CHUNK, total), total });
  }
  return runId;
}
