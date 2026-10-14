import { useRef, useState } from "react";
import { warn as logWarn } from "@tauri-apps/plugin-log";
import type { Ketcher } from "ketcher-core";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

const provider = new StandaloneStructServiceProvider();

type Props = { onAdd: (smiles: string) => void };

/** Ketcher structure editor; the drawn molecule is handed over as SMILES. */
export default function Sketcher({ onAdd }: Props) {
  const ketcher = useRef<Ketcher | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    const k = ketcher.current;
    if (!k) return;
    try {
      const smiles = (await k.getSmiles()).trim();
      if (!smiles) {
        setMessage("Draw a structure first.");
        return;
      }
      onAdd(smiles);
      setMessage(`Added ${smiles}`);
      k.setMolecule("");
    } catch (e) {
      setMessage(`Could not read the drawing: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="sketcher">
      <div className="sketcher-editor">
        <Editor
          staticResourcesUrl=""
          structServiceProvider={provider}
          disableMacromoleculesEditor
          errorHandler={(m) => void logWarn(`sketcher: ${m}`)}
          onInit={(k) => {
            ketcher.current = k;
          }}
        />
      </div>
      <div className="sketcher-actions">
        <button className="btn btn-primary" onClick={() => void add()}>
          Add to list
        </button>
        {message && <span className="muted mono">{message}</span>}
      </div>
    </div>
  );
}
