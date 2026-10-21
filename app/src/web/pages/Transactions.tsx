import { useState } from "react";
import { useSearchParams } from "react-router";
import { TRANSACTION_TYPES, type TransactionsResponse, type TxnRow } from "../../shared/types";
import { rangeWindow } from "../../shared/range";
import { ms, num, pct, rate } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { DataTable, RowButton, type Column } from "../components/DataTable";
import { StackedBars } from "../components/charts";
import { SamplesDialog, type SampleTarget } from "../components/Samples";
import { NoData } from "../components/NoData";
import { Card, ErrorBox, Loading, StatTile } from "../components/ui";

export function TransactionsPage() {
  const site = useSite();
  useDocumentTitle(`Transactions - ${site.name}`);
  const [range] = useRange();
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "";
  const { data, error, loading, reload } = useApi<TransactionsResponse>(
    `/api/sites/${site.id}/transactions?range=${range}${type ? `&type=${type}` : ""}`,
  );
  const [target, setTarget] = useState<SampleTarget | null>(null);
  const spanSeconds = rangeWindow(range).seconds;

  const open = (r: TxnRow) =>
    setTarget({
      by: "transaction",
      key: r.name,
      title: `Samples of ${r.name}`,
      description: `Representative requests of the ${r.name} transaction: the slowest, one near the 95th percentile and one near the median.`,
    });

  const columns: Column<TxnRow>[] = [
    {
      key: "name",
      header: "Transaction",
      sort: (r) => r.name,
      render: (r) => (
        <div>
          <RowButton onClick={() => open(r)}>{r.name}</RowButton>
          <div className="text-xs text-muted">{r.type}</div>
        </div>
      ),
    },
    { key: "share", header: "Total %", numeric: true, sort: (r) => r.share, render: (r) => pct(r.share) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "max", header: "Max", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
    { key: "avg", header: "Avg", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
    { key: "p50", header: "p50", numeric: true, sort: (r) => r.p50, render: (r) => ms(r.p50) },
    { key: "p95", header: "p95", numeric: true, sort: (r) => r.p95, render: (r) => ms(r.p95) },
    { key: "rate", header: "Rate per min", numeric: true, sort: (r) => r.ratePerMin, render: (r) => rate(r.ratePerMin) },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle description="Transactions are requests to the site, such as a page view, an admin screen, a REST call or a cron run.">
          Transactions
        </PageTitle>
        <div className="mb-4">
          <label htmlFor="txn-type" className="label">
            Type
          </label>
          <select
            id="txn-type"
            className="field w-auto"
            value={type}
            onChange={(e) =>
              setParams((p) => {
                const n = new URLSearchParams(p);
                if (e.target.value) n.set("type", e.target.value);
                else n.delete("type");
                return n;
              })
            }
          >
            <option value="">All types</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading transactions" />}
      {data && data.summary.requests === 0 && <NoData />}
      {data && data.summary.requests > 0 && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Requests" value={num(data.summary.requests)} hint={`${rate(data.summary.ratePerMin)} per min`} />
            <StatTile label="Avg" value={ms(data.summary.avg)} />
            <StatTile label="p50" value={ms(data.summary.p50)} />
            <StatTile label="p95" value={ms(data.summary.p95)} hint={`p99 ${ms(data.summary.p99)}`} />
            <StatTile label="Error rate" value={pct(data.summary.errorRate)} />
            <StatTile label="Avg queries" value={data.summary.avgQueries.toFixed(1)} />
          </dl>
          <Card title="Overall transaction time" description={`Average time per request, split into PHP, MySQL and external calls. Each bar is ${Math.round(data.bucketSeconds / 60)} minutes.`}>
            <div className="p-4">
              <StackedBars series={data.series} bucketSeconds={data.bucketSeconds} spanSeconds={spanSeconds} />
            </div>
          </Card>
          <Card title="Slowest transactions" description="Ordered by total time in the range. Open a transaction to see sample requests and their traces.">
            <DataTable
              caption="Slowest transactions"
              columns={columns}
              rows={data.rows}
              rowKey={(r) => r.name}
              initialSort={{ key: "share", dir: "desc" }}
              onRowClick={open}
            />
          </Card>
        </div>
      )}
      <SamplesDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
