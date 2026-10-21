import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { SpanKind, Trace, TraceSpan } from "../../shared/types";
import { component as parseComponent, dateTime, mb, ms, num, shareLevel, type Share } from "../lib/format";
import { formatSql } from "../lib/sql";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { useSite } from "../components/Layout";
import { BreakdownBar } from "../components/charts";
import { Card, CodeBlock, ComponentName, EmptyState, ErrorBox, Facts, KIND_LABEL, KindIcon, Loading, Modal, SeverityBadge } from "../components/ui";

const KINDS: SpanKind[] = ["db", "http", "callback", "plugin_load", "theme_load"];


const BAR_COLOR: Record<SpanKind, string> = {
  db: "var(--c-db)",
  http: "var(--c-http)",
  callback: "var(--c-php)",
  plugin_load: "var(--c-other)",
  theme_load: "var(--c-other)",
};

function ShareTag({ level }: { level: Share }) {
  if (level === "normal") return null;
  return level === "high" ? (
    <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0.5 9.5 9H0.5Z" fill="currentColor" />
      </svg>
      Over 25%
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="4" fill="currentColor" />
      </svg>
      Over 5%
    </span>
  );
}

export function TracePage() {
  const site = useSite();
  const { tid = "" } = useParams();
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<Trace>(`/api/sites/${site.id}/traces/${tid}`);
  useDocumentTitle(data ? `${data.name} trace - ${site.name}` : "Trace");
  const [kind, setKind] = useState<"" | SpanKind>("");
  const [sort, setSort] = useState<"start" | "duration">("start");
  const [selected, setSelected] = useState<TraceSpan | null>(null);

  const spans = useMemo(() => {
    if (!data) return [];
    const list = data.spans.filter((s) => kind === "" || s.kind === kind);
    return sort === "duration" ? [...list].sort((a, b) => b.duration - a.duration) : list;
  }, [data, kind, sort]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading trace" />;
  if (!data) return null;

  const total = Math.max(data.duration, ...data.spans.map((s) => s.start + s.duration), 1);
  const share = (s: TraceSpan) => (s.duration / Math.max(data.duration, 1)) * 100;
  const counts = Object.fromEntries(KINDS.map((k) => [k, data.spans.filter((s) => s.kind === k).length])) as Record<SpanKind, number>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Trace</p>
          <h2 className="mt-1 text-xl font-semibold break-words">{data.name}</h2>
          <p className="mb-4 text-sm break-all text-muted">
            <span className="mono">{data.method}</span> {data.url}
          </p>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Duration", ms(data.duration)],
                ["Status", <span className={data.status >= 500 ? "text-danger" : ""}>{data.status || "-"}</span>],
                ["Type", data.type],
                ["Queries", num(data.dbCount)],
                ["External calls", num(data.httpCount)],
                ["Peak memory", `${mb(data.memoryPeakMb)}${data.memoryLimitMb > 0 ? ` of ${data.memoryLimitMb} MB` : ""}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-md border border-line px-3 py-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <Facts
            items={[
              ["Time", dateTime(data.ts)],
              ["PHP", data.phpVersion || "Unknown"],
              ["WordPress", data.wpVersion || "Unknown"],
              ["Logged in user", data.userLoggedIn ? "Yes" : "No"],
              ["Transaction id", <code className="mono break-all">{data.id}</code>],
            ]}
          />
          <h3 className="mt-5 mb-2 text-sm font-semibold">Where the time went</h3>
          <BreakdownBar php={data.phpTime} db={data.dbTime} http={data.httpTime} />
        </div>
      </Card>

      {data.issues.length > 0 && (
        <Card title="Issues found in this request">
          <ul className="divide-y divide-line">
            {data.issues.map((i) => (
              <li key={i.fingerprint} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <SeverityBadge severity={i.severity} />
                <Link to={`/sites/${site.id}/issues/${i.fingerprint}?range=${range}`} className="link inline-flex min-h-10 items-center">
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.errors.length > 0 && (
        <Card title="PHP errors in this request">
          <ul className="divide-y divide-line">
            {data.errors.map((e, idx) => (
              <li key={idx} className="px-4 py-3 text-sm">
                <p className="font-semibold capitalize">{e.level}</p>
                <p className="break-words">{e.message}</p>
                <p className="mono text-xs text-muted break-all">
                  {e.file}
                  {e.line ? `:${e.line}` : ""} <span aria-hidden="true">·</span> {parseComponent(e.component).name}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Timeline"
        description={`${data.spans.length} spans${data.droppedSpans > 0 ? `, ${data.droppedSpans} more were dropped by the agent` : ""}. Spans over 5% of the request are marked, over 25% strongly marked.`}
      >
        <div className="flex flex-wrap gap-3 border-b border-line px-4 py-3">
          <div>
            <label htmlFor="span-kind" className="label">
              Kind
            </label>
            <select id="span-kind" className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value as "" | SpanKind)}>
              <option value="">All kinds ({data.spans.length})</option>
              {KINDS.filter((k) => counts[k] > 0).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]} ({counts[k]})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="span-sort" className="label">
              Sort by
            </label>
            <select id="span-sort" className="field w-auto" value={sort} onChange={(e) => setSort(e.target.value as "start" | "duration")}>
              <option value="start">Start time</option>
              <option value="duration">Duration</option>
            </select>
          </div>
        </div>
        {spans.length === 0 ? (
          <EmptyState title="No spans">
            {kind === "" && data.spans.length === 0
              ? "Span details are kept for a shorter time than transactions, so this older request has no timeline. The totals above are still correct."
              : "The agent did not record spans of this kind for this request."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)_13rem] gap-3 border-b border-line px-4 py-1 text-xs text-muted md:grid" aria-hidden="true">
              <span>Span</span>
              <span className="flex justify-between">
                <span>0 ms</span>
                <span>{ms(total / 2)}</span>
                <span>{ms(total)}</span>
              </span>
              <span className="text-right">Duration</span>
            </div>
            <ol className="divide-y divide-line">
              {spans.map((s) => {
                const sh = share(s);
                const level = shareLevel(sh);
                const left = Math.min(100, (s.start / total) * 100);
                const width = Math.max(0.4, Math.min(100 - left, (s.duration / total) * 100));
                const color = level === "high" ? "var(--danger)" : level === "notable" ? "var(--warn)" : BAR_COLOR[s.kind];
                return (
                  <li key={s.seq}>
                    <button
                      type="button"
                      onClick={() => setSelected(s)}
                      className="grid min-h-10 w-full grid-cols-1 gap-1 px-4 py-2 text-left hover:bg-surface-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_13rem] md:items-center md:gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <KindIcon kind={s.kind} className="shrink-0" />
                        <span className="sr-only">{KIND_LABEL[s.kind]}:</span>
                        <span className="min-w-0 truncate text-sm">{s.name}</span>
                      </span>
                      <span className="relative block h-3 rounded bg-surface-2" aria-hidden="true">
                        <span className="absolute top-0 h-3 rounded-sm" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-sm tabular-nums md:justify-end">
                        <span className="font-medium">{ms(s.duration)}</span>
                        <span className="text-xs text-muted">{sh.toFixed(1)}%</span>
                        <ShareTag level={level} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </Card>

      <SpanDrawer span={selected} transactionDuration={data.duration} onClose={() => setSelected(null)} />
    </div>
  );
}

function SpanDrawer({ span, transactionDuration, onClose }: { span: TraceSpan | null; transactionDuration: number; onClose: () => void }) {
  const s = span;
  const facts: [string, React.ReactNode][] = s
    ? [
        ["Kind", KIND_LABEL[s.kind]],
        ["Duration", ms(s.duration)],
        ["Share of transaction", `${((s.duration / Math.max(transactionDuration, 1)) * 100).toFixed(1)}%`],
        ["Starts at", ms(s.start)],
        ["Component", <ComponentName value={s.component} />],
        ...(s.kind === "callback"
          ? ([
              ["Hook", <code className="mono break-all">{s.hook}</code>],
              ["Self time", ms(s.self)],
              ...(s.file ? ([["File", <code className="mono break-all">{s.file}</code>]] as [string, React.ReactNode][]) : []),
            ] as [string, React.ReactNode][])
          : []),
        ...(s.kind === "db" && s.rows >= 0 ? ([["Rows", num(s.rows)]] as [string, React.ReactNode][]) : []),
        ...(s.kind === "http"
          ? ([
              ["URL", <span className="break-all">{s.url}</span>],
              ["Method", <code className="mono">{s.method}</code>],
              ["Status", s.status ? String(s.status) : "No response"],
            ] as [string, React.ReactNode][])
          : []),
      ]
    : [];

  const stackNote =
    s && s.stack.length === 0
      ? s.kind === "db" && s.duration < 1
        ? "Not captured because the query took less than 1 ms."
        : s.kind === "db" || s.kind === "http"
          ? "No stack trace was captured for this span."
          : "Stack traces are recorded for queries and external requests only."
      : null;

  return (
    <Modal open={s !== null} onClose={onClose} title={s?.name ?? ""} side>
      {s && (
        <div className="space-y-5">
          <Facts items={facts} />
          {s.error && (
            <div role="note" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger break-words">
              <p className="font-semibold">Error</p>
              <p>{s.error}</p>
            </div>
          )}
          {s.kind === "db" && s.sql && <CodeBlock code={formatSql(s.sql)} label="SQL" />}
          {s.kind === "db" && s.fingerprint && <CodeBlock code={s.fingerprint} label="Fingerprint" copy={false} />}
          <div>
            <h3 className="mb-1 text-sm font-medium">Stack trace</h3>
            {stackNote ? (
              <p className="text-sm text-muted">{stackNote}</p>
            ) : (
              <ol className="mono space-y-1 rounded-md border border-line bg-surface-2 p-3 break-all">
                {s.stack.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
