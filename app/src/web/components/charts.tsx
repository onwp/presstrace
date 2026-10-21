import type { TimeBucket } from "../../shared/types";
import { axisTime, ms } from "../lib/format";
import { useWidth } from "../lib/hooks";

const SERIES = [
  { key: "php", label: "PHP", color: "var(--c-php)" },
  { key: "db", label: "MySQL", color: "var(--c-db)" },
  { key: "http", label: "External", color: "var(--c-http)" },
] as const;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {SERIES.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Average PHP, MySQL and external time per request, stacked per time bucket. */
export function StackedBars({ series, bucketSeconds, spanSeconds }: { series: TimeBucket[]; bucketSeconds: number; spanSeconds: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 200;
  const pad = { top: 8, right: 8, bottom: 24, left: 56 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.map((b) => b.php + b.db + b.http)));
  const slot = series.length ? plotW / series.length : 0;
  const barW = Math.max(1, slot * 0.72);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotW / 70))));
  const total = series.reduce((n, b) => n + b.requests, 0);

  return (
    <div>
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Average transaction time per ${Math.round(bucketSeconds / 60)} minute bucket, split into PHP, MySQL and external time. Peak ${ms(Math.max(0, ...series.map((b) => b.php + b.db + b.http)))}. Data table below.`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
                <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                  {ms(t)}
                </text>
              </g>
            ))}
            {series.map((b, i) => {
              const x = pad.left + i * slot + (slot - barW) / 2;
              let acc = 0;
              return (
                <g key={b.t}>
                  <title>{`${axisTime(b.t, spanSeconds)}: ${b.requests} requests, PHP ${ms(b.php)}, MySQL ${ms(b.db)}, External ${ms(b.http)}`}</title>
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
                  {SERIES.map((s) => {
                    const v = b[s.key];
                    if (v <= 0) return null;
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    return <rect key={s.key} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} fill={s.color} />;
                  })}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
                      {axisTime(b.t, spanSeconds)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <span className="text-sm text-muted">{total} requests in range</span>
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-accent">Show chart data as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Average transaction time per bucket</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="py-1 pr-3">Time</th>
                <th scope="col" className="py-1 pr-3 text-right">Requests</th>
                <th scope="col" className="py-1 pr-3 text-right">PHP</th>
                <th scope="col" className="py-1 pr-3 text-right">MySQL</th>
                <th scope="col" className="py-1 text-right">External</th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((b) => b.requests > 0)
                .map((b) => (
                  <tr key={b.t} className="border-t border-line tabular-nums">
                    <td className="py-1 pr-3">{axisTime(b.t, spanSeconds)}</td>
                    <td className="py-1 pr-3 text-right">{b.requests}</td>
                    <td className="py-1 pr-3 text-right">{ms(b.php)}</td>
                    <td className="py-1 pr-3 text-right">{ms(b.db)}</td>
                    <td className="py-1 text-right">{ms(b.http)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="block">
      <polyline points={points} fill="none" stroke="var(--c-php)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** One horizontal bar split into PHP, MySQL and external time, with values in text. */
export function BreakdownBar({ php, db, http }: { php: number; db: number; http: number }) {
  const total = php + db + http || 1;
  const parts = [
    { label: "PHP", value: php, color: "var(--c-php)" },
    { label: "MySQL", value: db, color: "var(--c-db)" },
    { label: "External", value: http, color: "var(--c-http)" },
  ];
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded bg-surface-2" aria-hidden="true">
        {parts.map((p) =>
          p.value > 0 ? (
            <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="h-full border-r-2 border-surface last:border-r-0" />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="font-semibold tabular-nums">{ms(p.value)}</span>
            <span className="text-muted tabular-nums">({((p.value / total) * 100).toFixed(1)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
