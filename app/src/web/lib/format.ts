const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function ms(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value >= 10_000) return `${nf2.format(value / 1000)} s`;
  if (value >= 100) return `${nf0.format(value)} ms`;
  return `${nf1.format(value)} ms`;
}

export function num(value: number): string {
  return nf0.format(value);
}

export function pct(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${nf1.format(value)}%`;
}

export function rate(value: number): string {
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  return value >= 100 ? nf0.format(value) : nf2.format(value);
}

export function mb(value: number): string {
  return `${nf1.format(value)} MB`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function dateTime(ts: number): string {
  return dateFmt.format(new Date(ts));
}

export function axisTime(ts: number, spanSeconds: number): string {
  return spanSeconds > 86_400 ? dayFmt.format(new Date(ts)) : timeFmt.format(new Date(ts));
}

export function ago(ts: number | null, now: number = Date.now()): string {
  if (!ts) return "Never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "plugin:woocommerce" -> { name: "woocommerce", kind: "Plugin" } */
export function component(value: string): { name: string; kind: string } {
  const i = value.indexOf(":");
  if (i === -1) return { name: value === "core" ? "WordPress core" : value, kind: value === "core" ? "Core" : "Unknown" };
  const kind = value.slice(0, i);
  const labels: Record<string, string> = { plugin: "Plugin", "mu-plugin": "Must-use plugin", theme: "Theme", dropin: "Drop-in" };
  return { name: value.slice(i + 1), kind: labels[kind] ?? kind };
}

export type Share = "high" | "notable" | "normal";

/** How strongly a span is marked in the timeline: over 25% of the request is high, over 5% notable. */
export function shareLevel(share: number): Share {
  if (share > 25) return "high";
  if (share > 5) return "notable";
  return "normal";
}
