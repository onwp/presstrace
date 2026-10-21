import { useState } from "react";
import type { ErrorGroup } from "../../shared/types";
import { ago, dateTime, num } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { DataTable, RowButton, type Column } from "../components/DataTable";
import { SamplesDialog, type SampleTarget } from "../components/Samples";
import { NoData } from "../components/NoData";
import { Card, ComponentName, ErrorBox, Loading } from "../components/ui";

const LEVEL_STYLE: Record<string, string> = {
  fatal: "text-danger",
  exception: "text-danger",
  error: "text-danger",
  warning: "text-warn",
};

export function ErrorsPage() {
  const site = useSite();
  useDocumentTitle(`Errors - ${site.name}`);
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<{ rows: ErrorGroup[] }>(`/api/sites/${site.id}/errors?range=${range}`);
  const [target, setTarget] = useState<SampleTarget | null>(null);

  const open = (r: ErrorGroup) =>
    setTarget({
      by: "error",
      key: r.fingerprint,
      title: `Requests with this ${r.level}`,
      description: r.message,
    });

  const cols: Column<ErrorGroup>[] = [
    {
      key: "message",
      header: "Message",
      sort: (r) => r.message,
      className: "max-w-[32rem]",
      render: (r) => (
        <div>
          <RowButton onClick={() => open(r)}>
            <span className="line-clamp-3 break-words">{r.message}</span>
          </RowButton>
          {r.file && (
            <div className="mono text-xs text-muted break-all">
              {r.file}
              {r.line ? `:${r.line}` : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "level",
      header: "Level",
      sort: (r) => r.level,
      render: (r) => <span className={`font-semibold capitalize ${LEVEL_STYLE[r.level] ?? "text-muted"}`}>{r.level}</span>,
    },
    { key: "component", header: "Component", sort: (r) => r.component, render: (r) => <ComponentName value={r.component} /> },
    { key: "count", header: "Count", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
    { key: "first", header: "First seen", sort: (r) => r.firstSeen, render: (r) => <span title={dateTime(r.firstSeen)}>{ago(r.firstSeen)}</span> },
    { key: "last", header: "Last seen", sort: (r) => r.lastSeen, render: (r) => <span title={dateTime(r.lastSeen)}>{ago(r.lastSeen)}</span> },
  ];

  return (
    <>
      <PageTitle description="PHP errors, warnings, notices and uncaught exceptions, grouped by message and location.">Errors</PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading errors" />}
      {data && data.rows.length === 0 && <NoData what="PHP errors" normal="No request in this range raised a PHP error, warning or notice. Pick a longer time range to look further back." />}
      {data && data.rows.length > 0 && (
        <Card title="PHP errors">
          <DataTable caption="PHP errors" columns={cols} rows={data.rows} rowKey={(r) => r.fingerprint} initialSort={{ key: "count", dir: "desc" }} onRowClick={open} />
        </Card>
      )}
      <SamplesDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
