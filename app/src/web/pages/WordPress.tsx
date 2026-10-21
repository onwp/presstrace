import { useState } from "react";
import type { CallbackRow, ComponentRow, LoadRow, WordPressResponse } from "../../shared/types";
import { component, ms, num, pct, rate } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { DataTable, RowButton, type Column } from "../components/DataTable";
import { SamplesDialog, type SampleTarget } from "../components/Samples";
import { NoData } from "../components/NoData";
import { Card, ComponentName, EmptyState, ErrorBox, Loading } from "../components/ui";

export function WordPressPage() {
  const site = useSite();
  useDocumentTitle(`WordPress - ${site.name}`);
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<WordPressResponse>(`/api/sites/${site.id}/wordpress?range=${range}`);
  const [target, setTarget] = useState<SampleTarget | null>(null);

  const openComponent = (value: string) => {
    const c = component(value);
    setTarget({
      by: "component",
      key: value,
      title: `Samples where ${c.name} ran`,
      description: `Requests in which the ${c.kind.toLowerCase()} ${c.name} ran, measured by its own (self) time.`,
    });
  };
  const openCallback = (r: CallbackRow) =>
    setTarget({
      by: "callback",
      key: JSON.stringify([r.name, r.hook, r.component]),
      title: `Samples of ${r.name}`,
      description: `Requests in which the callback ${r.name} ran on ${r.hook}.`,
    });

  const compCols: Column<ComponentRow>[] = [
    {
      key: "component",
      header: "Plugin or theme",
      sort: (r) => r.component,
      render: (r) => (
        <RowButton onClick={() => openComponent(r.component)}>
          <ComponentName value={r.component} />
        </RowButton>
      ),
    },
    { key: "share", header: "Self time %", numeric: true, sort: (r) => r.share, render: (r) => pct(r.share) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "max", header: "Max", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
    { key: "avg", header: "Avg per request", numeric: true, sort: (r) => r.avgPerRequest, render: (r) => ms(r.avgPerRequest) },
    { key: "calls", header: "Callback calls", numeric: true, sort: (r) => r.calls, render: (r) => num(r.calls) },
    { key: "rate", header: "Rate per min", numeric: true, sort: (r) => r.ratePerMin, render: (r) => rate(r.ratePerMin) },
  ];

  const cbCols: Column<CallbackRow>[] = [
    {
      key: "name",
      header: "Callback",
      sort: (r) => r.name,
      render: (r) => (
        <RowButton onClick={() => openCallback(r)}>
          <span className="mono">{r.name}</span>
        </RowButton>
      ),
    },
    { key: "hook", header: "Hook", sort: (r) => r.hook, className: "min-w-[14rem]", render: (r) => <span className="mono break-all">{r.hook}</span> },
    { key: "component", header: "Component", sort: (r) => r.component, render: (r) => <ComponentName value={r.component} /> },
    { key: "count", header: "Calls", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
    { key: "total", header: "Total", numeric: true, sort: (r) => r.total, render: (r) => ms(r.total) },
    { key: "avg", header: "Avg", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
    { key: "max", header: "Max", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
  ];

  const loadCols: Column<LoadRow>[] = [
    {
      key: "name",
      header: "File",
      sort: (r) => r.name,
      render: (r) => (
        <RowButton onClick={() => openComponent(r.component)}>
          <span className="mono break-all">{r.name}</span>
        </RowButton>
      ),
    },
    { key: "kind", header: "Type", sort: (r) => r.kind, render: (r) => (r.kind === "theme_load" ? "Theme" : "Plugin") },
    { key: "avg", header: "Avg load", numeric: true, sort: (r) => r.avg, render: (r) => ms(r.avg) },
    { key: "max", header: "Max load", numeric: true, sort: (r) => r.max, render: (r) => ms(r.max) },
    { key: "count", header: "Loads", numeric: true, sort: (r) => r.count, render: (r) => num(r.count) },
  ];

  const empty = data && data.components.length === 0 && data.callbacks.length === 0 && data.loads.length === 0;

  return (
    <>
      <PageTitle description="Time spent in each plugin and theme, excluding time spent in other plugins they call (self time).">WordPress</PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading plugins" />}
      {empty && <NoData what="plugin timings" />}
      {data && !empty && (
        <div className="space-y-4">
          <Card title="Slowest plugins and themes">
            <DataTable
              caption="Slowest plugins and themes"
              columns={compCols}
              rows={data.components}
              rowKey={(r) => r.component}
              initialSort={{ key: "share", dir: "desc" }}
              onRowClick={(r) => openComponent(r.component)}
              empty={<EmptyState title="No plugin timings in this range" />}
            />
          </Card>
          <Card title="Slowest callbacks" description="Hook callbacks of plugins and themes that took 1 ms or more.">
            <DataTable
              caption="Slowest callbacks"
              columns={cbCols}
              rows={data.callbacks}
              rowKey={(r) => `${r.name}|${r.hook}|${r.component}`}
              initialSort={{ key: "total", dir: "desc" }}
              onRowClick={openCallback}
              empty={<EmptyState title="No callbacks of 1 ms or more in this range" />}
            />
          </Card>
          <Card title="Plugin and theme load times" description="Time to include each plugin file and set up the theme, before any hooks run.">
            <DataTable
              caption="Plugin and theme load times"
              columns={loadCols}
              rows={data.loads}
              rowKey={(r) => `${r.kind}|${r.name}`}
              initialSort={{ key: "avg", dir: "desc" }}
              onRowClick={(r) => openComponent(r.component)}
              empty={<EmptyState title="No load timings in this range" />}
            />
          </Card>
        </div>
      )}
      <SamplesDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
