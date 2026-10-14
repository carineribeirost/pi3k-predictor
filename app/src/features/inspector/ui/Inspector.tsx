import { useEffect, useMemo, useState, type ReactNode } from "react";
import { warn as logWarn } from "@tauri-apps/plugin-log";
import type { MolRow } from "../../../bindings/MolRow";
import type { Prediction } from "../../../bindings/Prediction";
import type { ReferenceData } from "../../../bindings/ReferenceData";
import { domainVerdict, inDomain, num } from "../../../shared/lib/format";
import { rdkit } from "../../../shared/lib/rdkit/client";
import type { Highlight } from "../../../shared/lib/rdkit/protocol";
import { MolImage } from "../../../shared/ui/MolImage";
import "./inspector.css";

const DISAGREE = 0.15;
const LOW_SIMILARITY = 0.3;

type Props = { row: MolRow; reference: ReferenceData; threshold: number };

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="insp-section" open={open}>
      <summary>{title}</summary>
      <div className="insp-content">{children}</div>
    </details>
  );
}

/** Where a value sits against its limit, drawn as a bar with a tick at the limit. */
function Bullet({ value, limit, max, label }: { value: number; limit: number; max: number; label: string }) {
  const at = (x: number) => `${Math.min(100, (100 * x) / max)}%`;
  return (
    <div className="bullet">
      <div className="bullet-head">
        <span>{label}</span>
        <span className="mono">
          {value.toPrecision(3)} / {limit.toPrecision(3)}
        </span>
      </div>
      <div className="bar">
        <span style={{ width: at(value), background: value <= limit ? "var(--accent)" : "var(--ood)" }} />
        <i className="tick" style={{ left: at(limit) }} />
      </div>
    </div>
  );
}

function EnsembleStrip({ p, threshold }: { p: Prediction; threshold: number }) {
  return (
    <svg className="strip" viewBox="0 0 300 40" role="img" aria-label={`Forest probabilities, mean ${num(p.mean)}`}>
      <line x1="10" x2="290" y1="20" y2="20" className="strip-axis" />
      <line x1={10 + 280 * threshold} x2={10 + 280 * threshold} y1="6" y2="34" className="strip-threshold" />
      <rect
        x={10 + 280 * Math.max(0, p.mean - p.std)}
        width={280 * Math.min(1, 2 * p.std)}
        y="14"
        height="12"
        className="strip-band"
        rx="3"
      />
      {p.probs.map((x, i) => (
        <circle key={i} cx={10 + 280 * x} cy="20" r="4" className={x >= threshold ? "strip-dot active" : "strip-dot"} />
      ))}
      <text x="10" y="39" className="strip-tick">
        0
      </text>
      <text x="290" y="39" textAnchor="end" className="strip-tick">
        1
      </text>
    </svg>
  );
}

function Properties({ json }: { json: string | null }) {
  const d = useMemo(() => {
    try {
      return json ? (JSON.parse(json) as Record<string, number>) : null;
    } catch {
      return null;
    }
  }, [json]);
  if (!d) return <p className="muted">No descriptors stored for this molecule.</p>;
  const lipinski = [d.amw <= 500, d.CrippenClogP <= 5, d.lipinskiHBD <= 5, d.lipinskiHBA <= 10].filter(
    (ok) => !ok,
  ).length;
  const veber = d.NumRotatableBonds <= 10 && d.tpsa <= 140;
  const rows: [string, string][] = [
    ["Molecular weight", num(d.amw, 1)],
    ["cLogP (Crippen)", num(d.CrippenClogP)],
    ["TPSA", `${num(d.tpsa, 1)} Å²`],
    ["H-bond donors", String(d.lipinskiHBD)],
    ["H-bond acceptors", String(d.lipinskiHBA)],
    ["Rotatable bonds", String(d.NumRotatableBonds)],
    ["Aromatic rings", String(d.NumAromaticRings)],
    ["Heavy atoms", String(d.NumHeavyAtoms)],
  ];
  return (
    <>
      <dl className="props">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="chips">
        <span className={`chip ${lipinski <= 1 ? "chip-ok" : "chip-ood"}`}>
          Lipinski: {lipinski === 0 ? "pass" : `${lipinski} violation${lipinski > 1 ? "s" : ""}`}
        </span>
        <span className={`chip ${veber ? "chip-ok" : "chip-ood"}`}>Veber: {veber ? "pass" : "fail"}</span>
      </div>
    </>
  );
}

export function Inspector({ row, reference, threshold }: Props) {
  const p = row.prediction;
  const [hoverBit, setHoverBit] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<Map<number, Highlight>>(new Map());
  const smiles = row.canonical ?? row.smiles;

  const bits = useMemo(
    () =>
      reference.bits
        .map((b, i) => ({ ...b, slot: i, on: p ? (p.bits >>> i) & 1 : 0 }))
        .sort((a, b) => b.importance - a.importance),
    [reference.bits, p],
  );

  useEffect(() => {
    if (!p) return;
    let live = true;
    const queries = reference.bits.flatMap((b, slot) => b.smarts.map((s) => ({ slot, s })));
    rdkit
      .match(
        smiles,
        queries.map((q) => q.s),
      )
      .then((found) => {
        if (!live) return;
        const merged = new Map<number, { atoms: Set<number>; bonds: Set<number> }>();
        found.forEach((h, k) => {
          const m = merged.get(queries[k].slot) ?? { atoms: new Set(), bonds: new Set() };
          h.atoms.forEach((a) => m.atoms.add(a));
          h.bonds.forEach((b) => m.bonds.add(b));
          merged.set(queries[k].slot, m);
        });
        setHighlights(new Map([...merged].map(([slot, m]) => [slot, { atoms: [...m.atoms], bonds: [...m.bonds] }])));
      })
      .catch((e: Error) => {
        void logWarn(`bit highlighting failed for ${smiles}: ${e.message}`);
        if (live) setHighlights(new Map());
      });
    return () => {
      live = false;
    };
  }, [smiles, p, reference.bits]);

  if (!p) {
    return (
      <aside className="inspector">
        <div className="insp-title">
          <h2>{row.inputId ?? `Molecule ${row.index + 1}`}</h2>
          <span className="chip chip-error">⚠ Invalid input</span>
        </div>
        <p className="mono insp-smiles">{row.smiles || "(empty)"}</p>
        <p>{row.error}</p>
      </aside>
    );
  }

  const active = p.mean >= threshold;
  const maxSim = p.analogs[0]?.similarity ?? 0;
  const t = reference.train;

  return (
    <aside className="inspector">
      <div className="insp-title">
        <h2>{row.inputId ?? `Molecule ${row.index + 1}`}</h2>
        <span className={`chip ${active ? "chip-active" : "chip-inactive"}`}>{active ? "Active" : "Inactive"}</span>
      </div>

      <Section title="Structure">
        <MolImage
          smiles={smiles}
          width={340}
          height={230}
          highlight={hoverBit === null ? undefined : highlights.get(hoverBit)}
          className="mol-card insp-mol"
        />
        <p className="mono insp-smiles">
          {smiles}{" "}
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(smiles)}
            title="Copy SMILES"
          >
            Copy
          </button>
        </p>
      </Section>

      <Section title="Prediction">
        <div className="big-p">
          <strong>{num(p.mean)}</strong>
          <span className="muted">
            mean P(active) over {p.probs.length} forests, threshold {num(threshold)}
          </span>
        </div>
        <EnsembleStrip p={p} threshold={threshold} />
        <p className={p.std > DISAGREE ? "warn" : "muted"}>
          {p.std > DISAGREE
            ? `Models disagree (σ = ${num(p.std)}). Treat this prediction with caution.`
            : `Forests agree (σ = ${num(p.std)}).`}
        </p>
      </Section>

      <Section title="Applicability domain">
        <p>
          <span className={`chip ${inDomain(p) ? "chip-ok" : "chip-ood"}`}>
            {inDomain(p) ? "" : "⚠ "}
            {domainVerdict(p)}
          </span>
        </p>
        <Bullet
          value={p.leverage}
          limit={reference.leverageThreshold}
          max={reference.leverageThreshold * 2}
          label="Leverage"
        />
        <Bullet
          value={p.distance}
          limit={reference.distanceThreshold}
          max={reference.distanceThreshold * 1.5}
          label={`Mean distance to ${reference.k} nearest`}
        />
        <p className="muted">
          {inDomain(p)
            ? "The molecule sits within the chemical space the models were trained on."
            : "The molecule lies outside the training chemical space, so the prediction is an extrapolation."}
        </p>
      </Section>

      <Section title="Nearest training analogs">
        {maxSim < LOW_SIMILARITY && (
          <p className="warn">No close analog in the training set (best Tanimoto {num(maxSim)}).</p>
        )}
        <ul className="analogs">
          {p.analogs.map((a) => (
            <li key={a.trainIndex}>
              <MolImage smiles={t.smiles[a.trainIndex]} width={96} height={64} className="mol-card" />
              <div>
                <div className="mono">{t.chemblId[a.trainIndex]}</div>
                <div className="muted">
                  pIC50 {num(t.pic50[a.trainIndex])} ·{" "}
                  <span className={t.active[a.trainIndex] ? "txt-active" : undefined}>
                    {t.active[a.trainIndex] ? "active" : "inactive"}
                  </span>
                </div>
              </div>
              <div className="sim mono">{num(a.similarity)}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Bit explanation" open={false}>
        <p className="muted">
          The model reads 32 Morgan fingerprint bits. Hover a bit to highlight atoms that typically set it (hashed bits
          can collide, so this is approximate).
        </p>
        <ul className="bits">
          {bits.map((b) => (
            <li
              key={b.bit}
              onMouseEnter={() => setHoverBit(b.slot)}
              onMouseLeave={() => setHoverBit(null)}
              onFocus={() => setHoverBit(b.slot)}
              onBlur={() => setHoverBit(null)}
              tabIndex={0}
              className={b.on ? "on" : undefined}
            >
              <span className="mono">{b.bit}</span>
              <span className={`dot ${b.on ? "dot-on" : ""}`} aria-label={b.on ? "set" : "not set"} />
              <div className="bar" title={`importance ${num(b.importance, 3)}`}>
                <span style={{ width: `${Math.min(100, b.importance * 400)}%` }} />
              </div>
              <span className="muted freq">
                {Math.round(b.freqActive * 100)}% / {Math.round(b.freqInactive * 100)}%
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">
          Columns: bit, set in this molecule, importance, share of training actives / inactives with the bit.
        </p>
      </Section>

      <Section title="Properties" open={false}>
        <Properties json={row.descriptors} />
      </Section>
    </aside>
  );
}
