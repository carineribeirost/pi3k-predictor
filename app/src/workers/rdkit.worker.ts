import initRDKitModule, { type MainModule as RDKitModule, type Mol } from "@rdkit/rdkit";
import wasmUrl from "@rdkit/rdkit/RDKit_minimal.wasm?url";
import { matchAll } from "../shared/lib/rdkit/match";
import { prepare } from "../shared/lib/rdkit/prepare";
import type { Highlight, RdkitRequest, WorkerMessage, WorkerReply } from "../shared/lib/rdkit/protocol";

const ready: Promise<RDKitModule> = initRDKitModule({ locateFile: () => wasmUrl });

function withMol<T>(rdkit: RDKitModule, smiles: string, fallback: T, fn: (mol: Mol) => T): T {
  const mol = rdkit.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return fallback;
  }
  try {
    return fn(mol);
  } finally {
    mol.delete();
  }
}

function handle(rdkit: RDKitModule, req: RdkitRequest): unknown {
  switch (req.type) {
    case "prepare":
      return req.items.map((it) => prepare(rdkit, it.index, it.smiles, it.inputId));
    case "validate":
      return req.lines.map((line) => withMol(rdkit, line, false, () => true));
    case "svg":
      return withMol(rdkit, req.smiles, null, (mol) =>
        mol.get_svg_with_highlights(
          JSON.stringify({
            width: req.width,
            height: req.height,
            atoms: req.highlight?.atoms ?? [],
            bonds: req.highlight?.bonds ?? [],
            highlightColour: [0.55, 0.86, 0.82],
            backgroundColour: [1, 1, 1, 0],
            clearBackground: false,
          }),
        ),
      );
    case "match":
      return withMol<Highlight[]>(
        rdkit,
        req.smiles,
        req.smarts.map(() => ({ atoms: [], bonds: [] })),
        (mol) => matchAll(rdkit, mol, req.smarts),
      );
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, ...req } = e.data;
  let reply: WorkerReply;
  try {
    reply = { id, ok: true, result: handle(await ready, req) };
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
