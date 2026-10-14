import { error as logError } from "@tauri-apps/plugin-log";
import type { Highlight, PrepareItem, RdkitRequest, RdkitResult, WorkerReply } from "./protocol";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../../workers/rdkit.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    void logError(`rdkit worker crashed: ${e.message}`);
    for (const p of pending.values()) p.reject(new Error("The chemistry engine stopped. Reload the window."));
    pending.clear();
    worker = null;
  };
  return worker;
}

function request<K extends RdkitRequest["type"]>(req: Extract<RdkitRequest, { type: K }>): Promise<RdkitResult[K]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, ...req });
  });
}

const svgCache = new Map<string, Promise<string | null>>();
const SVG_CACHE_LIMIT = 3000;

export const rdkit = {
  prepare: (items: PrepareItem[]) => request({ type: "prepare", items }),
  validate: (lines: string[]) => request({ type: "validate", lines }),
  match: (smiles: string, smarts: string[]) => request({ type: "match", smiles, smarts }),
  svg(smiles: string, width: number, height: number, highlight?: Highlight): Promise<string | null> {
    const key = `${width}x${height}|${smiles}|${highlight ? JSON.stringify(highlight) : ""}`;
    let hit = svgCache.get(key);
    if (!hit) {
      if (svgCache.size >= SVG_CACHE_LIMIT) svgCache.delete(svgCache.keys().next().value!);
      hit = request({ type: "svg", smiles, width, height, highlight });
      svgCache.set(key, hit);
      hit.catch(() => svgCache.delete(key));
    }
    return hit;
  },
};
