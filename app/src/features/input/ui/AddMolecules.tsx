import { useEffect, useMemo, useRef, useState } from "react";
import type { IpcError } from "../../../shared/lib/ipc";
import { rdkit } from "../../../shared/lib/rdkit/client";
import type { PrepareItem } from "../../../shared/lib/rdkit/protocol";
import { runPrediction, type InputKind, type Progress } from "../api/predict";
import { guessColumns, parseCsv, parseLines, splitSdf, tableEntries, type Entry, type Table } from "../lib/parse";
import exampleText from "../assets/example.smi?raw";
import "./input.css";

const MAX_MOLECULES = 200_000;
type Loaded = { name: string; kind: "lines" | "sdf"; entries: Entry[] } | { name: string; kind: "table"; table: Table };

export type Tab = "paste" | "file" | "example";
type Props = {
  open: boolean;
  initialTab: Tab;
  threshold: number;
  onClose: () => void;
  onDone: (runId: number) => void;
};

const stamp = () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function readFile(file: File): Promise<Loaded> {
  const text = await file.text();
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "tsv") return { name: file.name, kind: "table", table: parseCsv(text) };
  if (ext === "sdf" || ext === "sd" || text.includes("$$$$")) {
    return {
      name: file.name,
      kind: "sdf",
      entries: splitSdf(text).map((b) => ({ smiles: b.molblock, inputId: b.title })),
    };
  }
  return { name: file.name, kind: "lines", entries: parseLines(text) };
}

export function AddMolecules({ open, initialTab, threshold, onClose, onDone }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("paste");
  const [paste, setPaste] = useState("");
  const [pasteResult, setPasteResult] = useState<{ lines: Entry[]; valid: number; invalid: number[] } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [cols, setCols] = useState<{ smiles: number; id: number | null }>({ smiles: 0, id: null });
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setTab(initialTab);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initialTab]);

  const pasted = useMemo(() => parseLines(paste), [paste]);
  useEffect(() => {
    if (tab !== "paste" || pasted.length === 0 || pasted.length > 5000) return;
    let live = true;
    const t = setTimeout(() => {
      rdkit.validate(pasted.map((e) => e.smiles)).then(
        (ok) => {
          if (live)
            setPasteResult({
              lines: pasted,
              valid: ok.filter(Boolean).length,
              invalid: ok.flatMap((v, i) => (v ? [] : [i + 1])),
            });
        },
        (e: Error) => live && setError(`Could not check the pasted SMILES: ${e.message}`),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pasted, tab]);
  // A result only counts for the exact text it was computed from.
  const pasteCheck = pasteResult?.lines === pasted ? pasteResult : null;

  const entries: Entry[] = useMemo(() => {
    if (tab === "paste") return pasted;
    if (tab === "example") return parseLines(exampleText);
    if (!loaded) return [];
    return loaded.kind === "table" ? tableEntries(loaded.table, cols.smiles, cols.id) : loaded.entries;
  }, [tab, pasted, loaded, cols]);

  const defaultName =
    tab === "example"
      ? `Example set, ${stamp()}`
      : tab === "file" && loaded
        ? loaded.name
        : `Pasted molecules, ${stamp()}`;
  const busy = progress !== null;

  async function load(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const l = await readFile(file);
      setLoaded(l);
      if (l.kind === "table") setCols(guessColumns(l.table.header));
    } catch (e) {
      setError(`Could not read ${file.name}: ${String(e)}`);
    }
  }

  async function predict() {
    if (entries.length === 0) return;
    if (entries.length > MAX_MOLECULES) {
      setError(`At most ${MAX_MOLECULES.toLocaleString()} molecules per run.`);
      return;
    }
    setError(null);
    const items: PrepareItem[] = entries.map((e, index) => ({ index, smiles: e.smiles, inputId: e.inputId }));
    const kind: InputKind = tab === "paste" ? "paste" : tab === "file" ? "file" : "example";
    try {
      const runId = await runPrediction({
        name: name.trim() || defaultName,
        threshold,
        inputKind: kind,
        items,
        onProgress: setProgress,
      });
      setPaste("");
      setLoaded(null);
      setName("");
      onDone(runId);
    } catch (e) {
      const err = e as IpcError | Error;
      setError("kind" in err ? `${err.kind}: ${err.message}` : err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <dialog ref={dialog} className="add-dialog" onClose={onClose} onCancel={(e) => busy && e.preventDefault()}>
      <header className="add-head">
        <h2>Add molecules</h2>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="tabs" role="tablist">
        {(["paste", "file", "example"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} disabled={busy}>
            {t === "paste" ? "Paste" : t === "file" ? "File" : "Example"}
          </button>
        ))}
      </div>

      <div className="add-body">
        {tab === "paste" && (
          <>
            <textarea
              className="textarea"
              rows={12}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"One SMILES per line, optionally followed by a name\nCC(=O)Oc1ccccc1C(=O)O aspirin"}
              spellCheck={false}
              disabled={busy}
            />
            <p className="muted" aria-live="polite">
              {pasted.length === 0
                ? "Nothing pasted yet."
                : pasteCheck
                  ? `${pasteCheck.valid} valid · ${pasteCheck.invalid.length} invalid${
                      pasteCheck.invalid.length
                        ? ` (lines ${pasteCheck.invalid.slice(0, 8).join(", ")}${pasteCheck.invalid.length > 8 ? ", …" : ""})`
                        : ""
                    }`
                  : `${pasted.length} lines`}
            </p>
          </>
        )}

        {tab === "file" && (
          <>
            <label
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void load(e.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                accept=".txt,.smi,.csv,.tsv,.sdf,.sd"
                onChange={(e) => void load(e.target.files?.[0])}
                disabled={busy}
              />
              <strong>{loaded ? loaded.name : "Drop a file here or click to choose"}</strong>
              <span className="muted">.smi or .txt (one SMILES per line), .csv / .tsv, or .sdf</span>
            </label>
            {loaded?.kind === "table" && (
              <div className="col-pick">
                <label>
                  SMILES column
                  <select
                    className="select"
                    value={cols.smiles}
                    onChange={(e) => setCols({ ...cols, smiles: Number(e.target.value) })}
                  >
                    {loaded.table.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ID column
                  <select
                    className="select"
                    value={cols.id ?? ""}
                    onChange={(e) => setCols({ ...cols, id: e.target.value === "" ? null : Number(e.target.value) })}
                  >
                    <option value="">none</option>
                    {loaded.table.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {loaded && (
              <ul className="preview mono">
                {entries.slice(0, 5).map((e, i) => (
                  <li key={i}>
                    {e.inputId && <span className="muted">{e.inputId} · </span>}
                    {loaded.kind === "sdf" ? "(molblock)" : e.smiles}
                  </li>
                ))}
                <li className="muted">{entries.length.toLocaleString()} molecules</li>
              </ul>
            )}
          </>
        )}

        {tab === "example" && (
          <p>
            The {entries.length} molecules that shipped with the original PI3Kα predictor, useful for a first look at
            the workspace.
          </p>
        )}
      </div>

      <footer className="add-foot">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          aria-label="Run name"
          maxLength={200}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={() => void predict()} disabled={busy || entries.length === 0}>
          Predict {entries.length > 0 ? entries.length.toLocaleString() : ""}
        </button>
      </footer>
      {progress && (
        <div className="add-progress" aria-live="polite">
          <div className="bar">
            <span style={{ width: `${(100 * progress.done) / Math.max(progress.total, 1)}%` }} />
          </div>
          <span className="muted">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} predicted
          </span>
        </div>
      )}
      {error && (
        <p className="chip chip-error add-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
