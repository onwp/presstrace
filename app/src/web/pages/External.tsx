import { useState } from "react";
import type { ExternalRow } from "../../shared/types";
import { ms, num, pct, rate } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { DataTable, RowButton, type Column } from "../components/DataTable";
import { SamplesDialog, type SampleTarget } from "../components/Samples";
import { NoData } from "../components/NoData";
import { Card, ErrorBox, Loading } from "../components/ui";

export function ExternalPage() {
  const site = useSite();
  useDocumentTitle(`External - ${site.name}`);
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<{ rows: ExternalRow[] }>(`/api/sites/${site.id}/external?range=${range}`);
  const [target, setTarget] = useState<SampleTarget | null>(null);

  const open = (r: ExternalRow) =>
    setTarget({
      by: "external",
      key: `${r.method} ${r.host}`,
      title: `Samples of ${r.method} ${r.host}`,
      description: `Requests that called ${r.host} with ${r.method}. Values are the total time of these calls per request.`,
    });

  const cols: Column<ExternalRow>[] = [
    {
      key: "host",
      header: "Host",
      sort: (r) => r.host,
      render: (r) => (
        <RowButton onClick={() => open(r)}>
          <span className="break-all">{r.host}</span>
        </RowButton>
      ),
    },
    { key: "method", header: "Method", sort: (r) => r.method, render: (r) => <span className="mono">{r.method}</span> },
    { key: "share", header: "Total %", numeric: true, sort: (r) => r.share, render: (r) => pct(r.share) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "max", header: "Max", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
    { key: "avg", header: "Avg", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
    { key: "count", header: "Calls", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
    { key: "rate", header: "Rate per min", numeric: true, sort: (r) => r.ratePerMin, render: (r) => rate(r.ratePerMin) },
    {
      key: "errors",
      header: "Errors",
      numeric: true,
      sort: (r) => r.errors,
      render: (r) => (r.errors > 0 ? <span className="font-semibold text-danger">{num(r.errors)}</span> : "0"),
    },
  ];

  return (
    <>
      <PageTitle description="HTTP calls made through the WordPress HTTP API, grouped by host and method. PHP waits for each call to finish.">
        External requests
      </PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading external requests" />}
      {data && data.rows.length === 0 && <NoData what="external requests" normal="No request in this range called an external service through the WordPress HTTP API. Pick a longer time range to look further back." />}
      {data && data.rows.length > 0 && (
        <Card title="Slowest external requests">
          <DataTable caption="Slowest external requests" columns={cols} rows={data.rows} rowKey={(r) => `${r.method} ${r.host}`} initialSort={{ key: "share", dir: "desc" }} onRowClick={open} />
        </Card>
      )}
      <SamplesDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
