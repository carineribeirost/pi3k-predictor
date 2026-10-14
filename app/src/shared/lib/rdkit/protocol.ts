import type { MolIn } from "../../../bindings/MolIn";

export type PrepareItem = { index: number; smiles: string; inputId: string | null };
export type Highlight = { atoms: number[]; bonds: number[] };

export type RdkitRequest =
  | { type: "prepare"; items: PrepareItem[] }
  | { type: "validate"; lines: string[] }
  | { type: "svg"; smiles: string; width: number; height: number; highlight?: Highlight }
  | { type: "match"; smiles: string; smarts: string[] };

export type RdkitResult = {
  prepare: MolIn[];
  validate: boolean[];
  svg: string | null;
  match: Highlight[];
};

export type WorkerMessage = { id: number } & RdkitRequest;
export type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
