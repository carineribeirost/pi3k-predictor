import { useMemo, useState } from "react";
import type { MolRow } from "../../../bindings/MolRow";
import type { ReferenceData } from "../../../bindings/ReferenceData";
import { EChart, type ChartOption, type ClickParams } from "./EChart";
import "./charts.css";

type View = "distribution" | "domain" | "space";
type Props = {
  rows: MolRow[];
  reference: ReferenceData;
  threshold: number;
  selected: number | null;
  onSelect: (index: number) => void;
  /** Changes whenever the colour theme changes, so colours are re-read. */
  themeKey: string;
};

type Tokens = Record<
  "text" | "muted" | "border" | "accent" | "active" | "inactive" | "ood" | "train" | "surface",
  string
>;

function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    text: v("--text"),
    muted: v("--text-muted"),
    border: v("--border"),
    accent: v("--accent"),
    active: v("--active"),
    inactive: v("--inactive"),
    ood: v("--ood"),
    train: v("--train-point"),
    surface: v("--surface-1"),
  };
}

const axis = (t: Tokens, name: string) => ({
  name,
  nameLocation: "middle" as const,
  nameGap: 28,
  nameTextStyle: { color: t.muted },
  axisLine: { lineStyle: { color: t.border } },
  axisLabel: { color: t.muted },
  splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
});

const thresholdLine = (t: Tokens, axisKey: "xAxis" | "yAxis", value: number, label: string) => ({
  silent: true,
  symbol: "none",
  lineStyle: { color: t.text, type: "dashed" as const },
  label: { formatter: label, color: t.muted },
  data: [{ [axisKey]: value }],
});

export function ChartStrip({ rows, reference, threshold, selected, onSelect, themeKey }: Props) {
  const [view, setView] = useState<View>("distribution");
  const valid = useMemo(() => rows.filter((r) => r.prediction), [rows]);

  const option = useMemo<ChartOption>(() => {
    void themeKey;
    const t = readTokens();
    const base = {
      animation: false,
      textStyle: { color: t.text, fontFamily: "inherit" },
      grid: { left: 56, right: 24, top: 28, bottom: 44 },
      tooltip: { backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text } },
    };
    const runPoint = (r: MolRow, x: number, y: number) => {
      const active = r.prediction!.mean >= threshold;
      const sel = r.index === selected;
      return {
        value: [x, y, r.index],
        name: r.inputId ?? `#${r.index + 1}`,
        symbolSize: sel ? 16 : 9,
        itemStyle: {
          color: active ? t.active : t.inactive,
          borderColor: sel ? t.text : t.surface,
          borderWidth: sel ? 2 : 1,
        },
      };
    };

    if (view === "distribution") {
      const bins = 20;
      const act = new Array(bins).fill(0);
      const inact = new Array(bins).fill(0);
      for (const r of valid) {
        const m = r.prediction!.mean;
        const b = Math.min(bins - 1, Math.floor(m * bins));
        (m >= threshold ? act : inact)[b]++;
      }
      const labels = Array.from({ length: bins }, (_, i) => (i / bins).toFixed(2));
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: "axis" },
        legend: { top: 0, right: 8, textStyle: { color: t.muted } },
        xAxis: { ...axis(t, "P(active)"), type: "category", data: labels },
        yAxis: { ...axis(t, "Molecules"), type: "value", minInterval: 1 },
        series: [
          {
            name: "Predicted inactive",
            type: "bar",
            stack: "n",
            data: inact,
            itemStyle: { color: t.inactive },
            markLine: thresholdLine(
              t,
              "xAxis",
              Math.min(bins - 1, Math.floor(threshold * bins)),
              `threshold ${threshold.toFixed(2)}`,
            ),
          },
          { name: "Predicted active", type: "bar", stack: "n", data: act, itemStyle: { color: t.active } },
        ],
      };
    }

    const isDomain = view === "domain";
    const tr = reference.train;
    const train = tr.pca.map((p, i) => (isDomain ? [tr.distance[i], tr.leverage[i]] : [p[0], p[1]]));
    const run = valid.map((r) => {
      const p = r.prediction!;
      return isDomain ? runPoint(r, p.distance, p.leverage) : runPoint(r, p.pca[0], p.pca[1]);
    });
    return {
      ...base,
      legend: { top: 0, right: 8, textStyle: { color: t.muted } },
      tooltip: {
        ...base.tooltip,
        formatter: (p: { seriesId?: string; dataIndex: number; name?: string }) =>
          p.seriesId === "run"
            ? p.name
            : `${tr.chemblId[p.dataIndex]} (${tr.active[p.dataIndex] ? "active" : "inactive"})`,
      },
      dataZoom: [{ type: "inside", xAxisIndex: 0, yAxisIndex: 0 }],
      xAxis: { ...axis(t, isDomain ? `Mean distance to ${reference.k} nearest` : "PCA 1"), type: "value", scale: true },
      yAxis: { ...axis(t, isDomain ? "Leverage" : "PCA 2"), type: "value", scale: true },
      series: [
        {
          id: "train",
          name: isDomain ? "Training set" : "Training (colour = measured class)",
          type: "scatter",
          data: train,
          symbolSize: 4,
          itemStyle: isDomain
            ? { color: t.train }
            : { color: (p: { dataIndex: number }) => (tr.active[p.dataIndex] ? t.active : t.inactive), opacity: 0.25 },
          markLine: isDomain
            ? {
                ...thresholdLine(t, "xAxis", reference.distanceThreshold, "limit"),
                data: [{ xAxis: reference.distanceThreshold }, { yAxis: reference.leverageThreshold }],
              }
            : undefined,
        },
        { id: "run", name: "This run", type: "scatter", data: run, symbol: "diamond", z: 3 },
      ],
    };
  }, [view, valid, reference, threshold, selected, themeKey]);

  function onClick(p: ClickParams) {
    const v = (p.data as { value?: number[] } | undefined)?.value;
    if (p.seriesId === "run" && v) onSelect(v[2]);
  }

  return (
    <section className="chart-strip">
      <div className="tabs" role="tablist">
        {(
          [
            ["distribution", "Distribution"],
            ["domain", "Applicability domain"],
            ["space", "Chemical space"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
        {view !== "distribution" && (
          <span className="muted chart-hint">Scroll to zoom, click a diamond to select it</span>
        )}
      </div>
      <EChart option={option} onClick={onClick} label={view} />
    </section>
  );
}
