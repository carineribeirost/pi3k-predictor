import { useEffect, useRef } from "react";
import { BarChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;
export type ClickParams = { seriesId?: string; data?: unknown };

type Props = { option: ChartOption; onClick?: (p: ClickParams) => void; label: string };

export function EChart({ option, onClick, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);

  useEffect(() => {
    click.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, null, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => click.current?.(p as ClickParams));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} className="echart" role="img" aria-label={label} />;
}
