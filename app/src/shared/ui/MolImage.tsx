import { useEffect, useState } from "react";
import { rdkit } from "../lib/rdkit/client";
import type { Highlight } from "../lib/rdkit/protocol";

type Props = { smiles: string; width: number; height: number; highlight?: Highlight; className?: string };

/** 2D depiction drawn by RDKit, shown as an image so the SVG cannot run anything. */
export function MolImage({ smiles, width, height, highlight, className }: Props) {
  const [svg, setSvg] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    rdkit.svg(smiles, width, height, highlight).then(
      (s) => live && setSvg(s),
      () => live && setSvg(null),
    );
    return () => {
      live = false;
    };
  }, [smiles, width, height, highlight]);

  return (
    <div className={`mol-image ${className ?? ""}`} style={{ width, height }}>
      {svg ? (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={smiles}
          width={width}
          height={height}
        />
      ) : svg === null ? (
        <span className="muted">no structure</span>
      ) : null}
    </div>
  );
}
