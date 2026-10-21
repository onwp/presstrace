import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CreatedSite, SiteSummary } from "../../shared/types";
import { api } from "../lib/api";
import { ago, ms, num, pct } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { RangeControls, useSession } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { Sparkline } from "../components/charts";
import { SetupSteps } from "../components/Setup";
import { Card, EmptyState, ErrorBox, Loading, Modal, SeverityBadge } from "../components/ui";

export function FleetPage() {
  useDocumentTitle("Sites");
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<{ sites: SiteSummary[] }>(`/api/sites?range=${range}`);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const q = `?range=${range}`;

  const columns: Column<SiteSummary>[] = [
    {
      key: "name",
      header: "Site",
      sort: (s) => s.name.toLowerCase(),
      render: (s) => (
        <div className="min-w-0">
          <Link to={`/sites/${s.id}/transactions${q}`} className="link inline-flex min-h-10 items-center break-words">
            {s.name}
          </Link>
          <div className="text-xs text-muted break-all">{s.url}</div>
        </div>
      ),
    },
    { key: "requests", header: "Requests", numeric: true, sort: (s) => s.requests, render: (s) => num(s.requests) },
    { key: "avg", header: "Avg", numeric: true, sort: (s) => s.avg, render: (s) => (s.requests ? ms(s.avg) : "-") },
    { key: "p50", header: "p50", numeric: true, sort: (s) => s.p50, render: (s) => (s.requests ? ms(s.p50) : "-") },
    { key: "p95", header: "p95", numeric: true, sort: (s) => s.p95, render: (s) => (s.requests ? ms(s.p95) : "-") },
    { key: "err", header: "Error rate", numeric: true, sort: (s) => s.errorRate, render: (s) => (s.requests ? pct(s.errorRate) : "-") },
    {
      key: "issues",
      header: "Open issues",
      sort: (s) => s.issues.high * 1e6 + s.issues.medium * 1e3 + s.issues.low,
      render: (s) =>
        s.issues.high + s.issues.medium + s.issues.low === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          <Link to={`/sites/${s.id}/issues${q}`} className="relative inline-flex min-h-10 flex-wrap items-center gap-1">
            {s.issues.high > 0 && <SeverityBadge severity="high" count={s.issues.high} />}
            {s.issues.medium > 0 && <SeverityBadge severity="medium" count={s.issues.medium} />}
            {s.issues.low > 0 && <SeverityBadge severity="low" count={s.issues.low} />}
            <span className="sr-only"> severity issues</span>
          </Link>
        ),
    },
    {
      key: "seen",
      header: "Last seen",
      sort: (s) => s.lastSeen ?? 0,
      render: (s) =>
        s.lastSeen ? (
          <span className="whitespace-nowrap">{ago(s.lastSeen)}</span>
        ) : (
          <Link to={`/sites/${s.id}/settings${q}`} className="link inline-flex min-h-10 items-center whitespace-nowrap">
            No data yet, set up
          </Link>
        ),
    },
    {
      key: "trend",
      header: "Avg time trend",
      render: (s) => (s.requests > 0 ? <Sparkline values={s.spark} label={`Average duration trend for ${s.name}`} /> : <span className="text-muted">No data</span>),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="text-sm text-muted">Performance of every monitored WordPress site.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <RangeControls />
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Add site
          </button>
        </div>
      </div>
      <Card>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Loading sites" />}
        {data && (
          <DataTable
            caption="Monitored sites"
            columns={columns}
            rows={data.sites}
            rowKey={(s) => s.id}
            initialSort={{ key: "requests", dir: "desc" }}
            pageSize={25}
            onRowClick={(s) => navigate(`/sites/${s.id}/transactions${q}`)}
            empty={
              <EmptyState title="No sites yet">
                <p>Add a site to get its key, then install the PressTrace plugin on that WordPress site and paste two lines into wp-config.php.</p>
                <button type="button" className="btn-primary mt-3" onClick={() => setAdding(true)}>
                  Add your first site
                </button>
              </EmptyState>
            }
          />
        )}
      </Card>
      <AddSiteDialog open={adding} onClose={() => setAdding(false)} onCreated={reload} />
    </>
  );
}

function AddSiteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { publicUrl } = useSession();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedSite | null>(null);

  const close = () => {
    setName("");
    setUrl("https://");
    setError(null);
    setCreated(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<CreatedSite>("/api/sites", { method: "POST", body: { name, url } });
      setCreated(res);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={created ? `${created.site.name} is ready` : "Add site"} wide={created !== null}>
      {created ? (
        <div className="space-y-4">
          <p role="status" className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-fg">
            Copy the site key now. It is stored only as a hash and cannot be shown again. You can rotate it later from the site setup page.
          </p>
          <SetupSteps appUrl={publicUrl} siteKey={created.key} />
          <div className="flex flex-wrap justify-end gap-2">
            <Link to={`/sites/${created.site.id}/settings`} className="btn">
              Open site setup
            </Link>
            <button type="button" className="btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          {error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="site-name" className="label">
              Name
            </label>
            <input id="site-name" className="field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="site-url" className="label">
              URL
            </label>
            <input id="site-url" type="url" inputMode="url" className="field" required value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby="site-url-hint" />
            <p id="site-url-hint" className="mt-1 text-xs text-muted">
              The home address of the WordPress site, for example https://shop.example.com.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Adding..." : "Add site"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
