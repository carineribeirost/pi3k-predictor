import type { Prediction } from "../../bindings/Prediction";

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const num = (x: number, digits = 2) => x.toFixed(digits);

export const inDomain = (p: Prediction) => p.inLeverage && p.inDistance;

export function domainVerdict(p: Prediction): string {
  if (inDomain(p)) return "Inside";
  if (!p.inLeverage && !p.inDistance) return "Outside: leverage and distance";
  return p.inLeverage ? "Outside: distance" : "Outside: leverage";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
