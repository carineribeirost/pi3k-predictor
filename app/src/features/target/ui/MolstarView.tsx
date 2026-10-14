import { useEffect, useRef, useState } from "react";
import { warn as logWarn } from "@tauri-apps/plugin-log";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import type { Expression } from "molstar/lib/mol-script/language/expression";
import { Script } from "molstar/lib/mol-script/script";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { Color } from "molstar/lib/mol-util/color";
import {
  DOMAINS,
  HOTSPOT_COLOR,
  HOTSPOTS,
  LIGAND,
  LINKER_COLOR,
  P110,
  P85,
  P85_COLOR,
  STRUCTURE_URL,
} from "../lib/pi3k";
import "./target.css";

export type Preset = "overview" | "pocket" | "hotspots";
type Props = { preset: Preset; spin: boolean; themeKey: string; label: string };

const prop = MS.struct.atomProperty.macromolecular;
const chain = (id: string) => MS.core.rel.eq([prop.auth_asym_id(), id]);
const inRange = (a: number, b: number) => MS.core.rel.inRange([prop.auth_seq_id(), a, b]);
const residues = (ids: readonly number[]) => MS.core.set.has([MS.set(...ids), prop.auth_seq_id()]);
const atoms = (test: Record<string, Expression>) => MS.struct.generator.atomGroups(test);

const LIGAND_EXPR = atoms({ "residue-test": MS.core.rel.eq([prop.label_comp_id(), LIGAND]) });
const HOTSPOT_EXPR = atoms({ "chain-test": chain(P110), "residue-test": residues(HOTSPOTS.map((h) => h.residue)) });

function cssColor(name: string): Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  return Color(m ? parseInt(m[1], 16) : 0xffffff);
}

async function build(plugin: PluginContext) {
  const data = await plugin.builders.data.download(
    { url: STRUCTURE_URL, isBinary: true },
    { state: { isGhost: true } },
  );
  const trajectory = await plugin.builders.structure.parseTrajectory(data, "mmcif");
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const sb = plugin.builders.structure;

  const cartoon = async (expr: Expression, key: string, color: number) => {
    const c = await sb.tryCreateComponentFromExpression(structure, expr, key, { label: key });
    if (c)
      await sb.representation.addRepresentation(c, {
        type: "cartoon",
        color: "uniform",
        colorParams: { value: Color(color) },
      });
  };
  for (const d of DOMAINS) {
    await cartoon(atoms({ "chain-test": chain(P110), "residue-test": inRange(d.start, d.end) }), d.name, d.color);
  }
  const anyDomain = MS.core.logic.or(DOMAINS.map((d) => inRange(d.start, d.end)));
  await cartoon(
    atoms({ "chain-test": chain(P110), "residue-test": MS.core.logic.not([anyDomain]) }),
    "linkers",
    LINKER_COLOR,
  );
  await cartoon(atoms({ "chain-test": chain(P85) }), "p85", P85_COLOR);

  const ligand = await sb.tryCreateComponentFromExpression(structure, LIGAND_EXPR, "alpelisib", { label: "alpelisib" });
  if (ligand) await sb.representation.addRepresentation(ligand, { type: "ball-and-stick", color: "element-symbol" });
  const hot = await sb.tryCreateComponentFromExpression(structure, HOTSPOT_EXPR, "hotspots", { label: "hotspots" });
  if (hot) {
    await sb.representation.addRepresentation(hot, {
      type: "spacefill",
      color: "uniform",
      colorParams: { value: Color(HOTSPOT_COLOR) },
    });
    await sb.representation.addRepresentation(hot, { type: "label", typeParams: { level: "residue" } });
  }
  return structure.data!;
}

/** PI3Kα rendered with Mol*, coloured by domain, with alpelisib and the cancer hotspots. */
export function MolstarView({ preset, spin, themeKey, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const plugin = useRef<PluginContext | null>(null);
  const structure = useRef<Awaited<ReturnType<typeof build>> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let disposed = false;
    const p = new PluginContext(DefaultPluginSpec());
    plugin.current = p;
    (async () => {
      await p.init();
      if (!(await p.initViewerAsync(canvas.current!, host.current!))) throw new Error("WebGL is not available");
      structure.current = await build(p);
      if (!disposed) setState("ready");
    })().catch((e: Error) => {
      void logWarn(`3D viewer failed: ${e.message}`);
      if (!disposed) setState("failed");
    });
    return () => {
      disposed = true;
      plugin.current = null;
      p.dispose();
    };
  }, []);

  useEffect(() => {
    const p = plugin.current;
    if (state !== "ready" || !p?.canvas3d) return;
    p.canvas3d.setProps({ renderer: { backgroundColor: cssColor("--surface-1") } });
  }, [state, themeKey]);

  useEffect(() => {
    const p = plugin.current;
    if (state !== "ready" || !p?.canvas3d) return;
    p.canvas3d.setProps({
      // Speed is in rotations per second; the axis is in camera space.
      trackball: {
        animate: spin
          ? { name: "spin", params: { speed: 0.05, axis: Vec3.create(0, -1, 0) } }
          : { name: "off", params: {} },
      },
    });
  }, [state, spin]);

  useEffect(() => {
    const p = plugin.current;
    const s = structure.current;
    if (state !== "ready" || !p || !s) return;
    if (preset === "overview") {
      p.managers.camera.reset();
      return;
    }
    const sel = Script.getStructureSelection(preset === "pocket" ? LIGAND_EXPR : HOTSPOT_EXPR, s);
    p.managers.camera.focusLoci(StructureSelection.toLociWithSourceUnits(sel), {
      extraRadius: preset === "pocket" ? 6 : 10,
    });
  }, [state, preset]);

  return (
    <div className="molstar" ref={host} role="img" aria-label={label}>
      <canvas ref={canvas} />
      {state === "loading" && <div className="molstar-status muted">Loading structure…</div>}
      {state === "failed" && <div className="molstar-status muted">The 3D view could not start on this system.</div>}
    </div>
  );
}
