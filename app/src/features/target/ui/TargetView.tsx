import { useState } from "react";
import { DOMAINS, HOTSPOT_COLOR, HOTSPOTS, hex, LINKER_COLOR, P85_COLOR } from "../lib/pi3k";
import { MolstarView, type Preset } from "./MolstarView";

const PRESETS: [Preset, string][] = [
  ["overview", "Overview"],
  ["pocket", "ATP pocket"],
  ["hotspots", "Hotspots"],
];

export function TargetView({ themeKey }: { themeKey: string }) {
  const [preset, setPreset] = useState<Preset>("overview");
  const [spin, setSpin] = useState(false);

  return (
    <div className="target">
      <section className="target-view">
        <div className="target-controls">
          <div className="segmented" role="group" aria-label="View">
            {PRESETS.map(([p, label]) => (
              <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented">
            <button aria-pressed={spin} onClick={() => setSpin((s) => !s)}>
              Spin
            </button>
          </div>
          <span className="muted">Drag to rotate, scroll to zoom, right-drag to move.</span>
        </div>
        <MolstarView preset={preset} spin={spin} themeKey={themeKey} label="PI3Kα structure, PDB 4JPS" />
      </section>

      <aside className="target-side">
        <p className="label">Target</p>
        <h1>PI3Kα</h1>
        <p>
          Phosphoinositide 3-kinase α is a lipid kinase: it phosphorylates PIP2 to PIP3 at the cell membrane, which
          switches on AKT and mTOR signalling and drives cell growth and survival. The enzyme pairs the catalytic
          subunit p110α, encoded by PIK3CA, with the regulatory subunit p85α.
        </p>
        <p>
          PIK3CA is one of the most frequently mutated oncogenes in human cancer. Its most common mutations sit at three
          hotspots and raise the kinase&apos;s activity. Alpelisib, shown here in the ATP pocket, inhibits the α isoform
          selectively and is approved for PIK3CA-mutated, hormone receptor-positive breast cancer.
        </p>

        <h2 className="label">p110α domains</h2>
        <ul className="legend">
          {DOMAINS.map((d) => (
            <li key={d.name}>
              <span className="swatch" style={{ background: hex(d.color) }} />
              <span>{d.name}</span>
              <span className="mono muted">
                {d.start}–{d.end}
              </span>
            </li>
          ))}
          <li>
            <span className="swatch" style={{ background: hex(LINKER_COLOR) }} />
            <span>Linkers</span>
            <span />
          </li>
          <li>
            <span className="swatch" style={{ background: hex(P85_COLOR) }} />
            <span>p85α niSH2 (chain B)</span>
            <span />
          </li>
        </ul>

        <h2 className="label">Cancer hotspots</h2>
        <ul className="legend">
          {HOTSPOTS.map((h) => (
            <li key={h.label}>
              <span className="swatch" style={{ background: hex(HOTSPOT_COLOR), borderRadius: "50%" }} />
              <span>{h.label}</span>
              <span className="muted">{h.domain}</span>
            </li>
          ))}
        </ul>

        <h2 className="label">About this structure</h2>
        <p className="muted">
          PDB 4JPS, X-ray, 2.2 Å: p110α with the niSH2 fragment of p85α and alpelisib (ligand 1LT). Domain boundaries
          come from UniProt P42336.
        </p>
        <p className="muted">
          The predictor learned from measured activities, not from this structure. It does not dock molecules, so your
          compounds are never placed in the pocket.
        </p>
      </aside>
    </div>
  );
}
