import { Link, useSearchParams } from "react-router";
import { ISSUE_TYPE_LABELS, type IssueGroup, type IssuesResponse, type IssueType } from "../../shared/types";
import { ago, dateTime, num } from "../lib/format";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { PageTitle, useSite } from "../components/Layout";
import { NoData } from "../components/NoData";
import { Card, EmptyState, ErrorBox, Loading, SeverityBadge } from "../components/ui";

export function IssuesPage() {
  const site = useSite();
  useDocumentTitle(`Issues - ${site.name}`);
  const [range] = useRange();
  const [params, setParams] = useSearchParams();
  const severity = params.get("severity") ?? "";
  const type = params.get("type") ?? "";
  const route = params.get("route") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const qs = new URLSearchParams({ range, page: String(page) });
  if (severity) qs.set("severity", severity);
  if (type) qs.set("type", type);
  if (route) qs.set("route", route);
  const { data, error, loading, reload } = useApi<IssuesResponse>(`/api/sites/${site.id}/issues?${qs}`);

  const setFilter = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value) n.set(key, value);
      else n.delete(key);
      if (key !== "page") n.delete("page");
      return n;
    });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = severity !== "" || type !== "" || route !== "";
  const detailLink = (i: IssueGroup) => `/sites/${site.id}/issues/${i.fingerprint}?range=${range}`;

  return (
    <>
      <PageTitle description="Problems found automatically in incoming traces. Each row groups every occurrence of the same problem on the same route.">
        Issues
      </PageTitle>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="f-severity" className="label">
            Severity
          </label>
          <select id="f-severity" className="field" value={severity} onChange={(e) => setFilter("severity", e.target.value)}>
            <option value="">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-type" className="label">
            Type
          </label>
          <select id="f-type" className="field" value={type} onChange={(e) => setFilter("type", e.target.value)}>
            <option value="">All types</option>
            {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((t) => (
              <option key={t} value={t}>
                {ISSUE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-route" className="label">
            Route
          </label>
          <select id="f-route" className="field" value={route} onChange={(e) => setFilter("route", e.target.value)}>
            <option value="">All routes</option>
            {route && !data?.routes.includes(route) && <option value={route}>{route}</option>}
            {data?.routes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading issues" />}
      {data && data.total === 0 && !filtered && <NoData what="issues" normal="No request in this range matched an issue rule. Pick a longer time range to look further back." />}
      {data && data.total === 0 && filtered && (
        <Card>
          <EmptyState title="No issues match these filters">
            <button type="button" className="btn mt-2" onClick={() => setParams(new URLSearchParams({ range }))}>
              Clear filters
            </button>
          </EmptyState>
        </Card>
      )}
      {data && data.total > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Issues, page {page} of {pages}</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-muted">
                  <th scope="col" className="px-3 py-2">Severity</th>
                  <th scope="col" className="px-3 py-2">Issue</th>
                  <th scope="col" className="px-3 py-2">Route</th>
                  <th scope="col" className="px-3 py-2 text-right">Occurrences</th>
                  <th scope="col" className="px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.issues.map((i) => (
                  <tr key={i.fingerprint} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 align-top">
                      <SeverityBadge severity={i.severity} />
                    </td>
                    <td className="max-w-[28rem] px-3 py-2 align-top">
                      <Link to={detailLink(i)} className="link inline-flex min-h-10 items-center">
                        {i.title}
                      </Link>
                      {i.subject && <div className="mono line-clamp-2 text-xs text-muted break-all">{i.subject}</div>}
                    </td>
                    <td className="px-3 py-2 align-top break-words">{i.route}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{num(i.count)}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap" title={dateTime(i.lastSeen)}>
                      {ago(i.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm">
            <span className="text-muted">
              Page {page} of {pages}, {num(data.total)} issues
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>
                Previous
              </button>
              <button type="button" className="btn" disabled={page >= pages} onClick={() => setFilter("page", String(page + 1))}>
                Next
              </button>
            </div>
          </nav>
        </Card>
      )}
    </>
  );
}
