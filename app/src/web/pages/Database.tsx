import { useState } from "react";
import type { DatabaseResponse, QueryComponentRow, QueryRow } from "../../shared/types";
import { ms, num, pct } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { DataTable, RowButton, type Column } from "../components/DataTable";
import { SamplesDialog, type SampleTarget } from "../components/Samples";
import { NoData } from "../components/NoData";
import { Card, ComponentName, ErrorBox, Loading } from "../components/ui";

export function DatabasePage() {
  const site = useSite();
  useDocumentTitle(`Database - ${site.name}`);
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<DatabaseResponse>(`/api/sites/${site.id}/database?range=${range}`);
  const [target, setTarget] = useState<SampleTarget | null>(null);

  const open = (r: QueryRow) =>
    setTarget({
      by: "query",
      key: r.hash,
      title: "Samples of this query",
      description: `Requests that ran: ${r.fingerprint.slice(0, 300)}${r.fingerprint.length > 300 ? "..." : ""}. Values are the total time of this query per request.`,
    });

  const queryCols: Column<QueryRow>[] = [
    {
      key: "fp",
      header: "Query",
      sort: (r) => r.fingerprint,
      className: "max-w-[32rem]",
      render: (r) => (
        <RowButton onClick={() => open(r)}>
          <span className="mono line-clamp-3 break-all">{r.fingerprint}</span>
        </RowButton>
      ),
    },
    { key: "component", header: "Caller", sort: (r) => r.component, render: (r) => <ComponentName value={r.component} /> },
    { key: "share", header: "Total %", numeric: true, sort: (r) => r.share, render: (r) => pct(r.share) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "count", header: "Count", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
    { key: "avg", header: "Avg", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
    { key: "max", header: "Max", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
  ];

  const compCols: Column<QueryComponentRow>[] = [
    { key: "component", header: "Component", sort: (r) => r.component, render: (r) => <ComponentName value={r.component} /> },
    { key: "share", header: "Total %", numeric: true, sort: (r) => r.share, render: (r) => pct(r.share) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "count", header: "Queries", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
    { key: "avg", header: "Avg", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
  ];

  return (
    <>
      <PageTitle description="Queries are grouped by fingerprint: the same query with different values counts as one row.">Database</PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading queries" />}
      {data && data.queries.length === 0 && <NoData what="queries" />}
      {data && data.queries.length > 0 && (
        <div className="space-y-4">
          <Card title="Slowest queries">
            <DataTable
              caption="Slowest queries"
              columns={queryCols}
              rows={data.queries}
              rowKey={(r) => r.hash}
              initialSort={{ key: "share", dir: "desc" }}
              onRowClick={open}
            />
          </Card>
          <Card title="Queries by component" description="Which plugin, theme or core code runs the queries.">
            <DataTable caption="Queries by component" columns={compCols} rows={data.components} rowKey={(r) => r.component} initialSort={{ key: "share", dir: "desc" }} />
          </Card>
        </div>
      )}
      <SamplesDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
