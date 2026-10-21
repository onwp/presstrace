import { Link, useParams } from "react-router";
import { ISSUE_TYPE_LABELS, type IssueDetail } from "../../shared/types";
import { dateTime, mb, ms, num } from "../lib/format";
import { formatSql } from "../lib/sql";
import { useApi, useDocumentTitle, useRange } from "../lib/hooks";
import { useSite } from "../components/Layout";
import { Card, CodeBlock, ErrorBox, Facts, Loading, SeverityBadge } from "../components/ui";

const SQL_TYPES = new Set(["n_plus_one", "duplicate_query", "slow_query", "select_star"]);

function valueLabel(issue: IssueDetail): [string, string] | null {
  switch (issue.type) {
    case "n_plus_one":
    case "duplicate_query":
      return ["Most executions in one request", num(issue.maxValue)];
    case "too_many_queries":
      return ["Most queries in one request", num(issue.maxValue)];
    case "high_memory":
      return ["Highest peak memory", mb(issue.maxValue)];
    case "php_error":
      return null;
    default:
      return ["Slowest occurrence", ms(issue.maxValue)];
  }
}

export function IssueDetailPage() {
  const site = useSite();
  const { fp = "" } = useParams();
  const [range] = useRange();
  const { data, error, loading, reload } = useApi<IssueDetail>(`/api/sites/${site.id}/issues/${fp}?range=${range}`);
  useDocumentTitle(data ? `${data.title} - ${site.name}` : "Issue");
  const traceLink = (id: string) => `/sites/${site.id}/traces/${id}?range=${range}`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link to={`/sites/${site.id}/issues?range=${range}`} className="link inline-flex min-h-10 items-center">
          Back to issues
        </Link>
      </p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading issue" />}
      {data && (
        <div className="space-y-4">
          <Card>
            <div className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{data.title}</h2>
                <SeverityBadge severity={data.severity} />
              </div>
              <Facts
                items={[
                  ["Route", <code className="mono">{data.route}</code>],
                  ["Type", ISSUE_TYPE_LABELS[data.type] ?? data.type],
                  ["Occurrences", num(data.count)],
                  ["First seen", dateTime(data.firstSeen)],
                  ["Last seen", dateTime(data.lastSeen)],
                  ...(valueLabel(data) ? [valueLabel(data)!] : []),
                ]}
              />
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="What is happening">
              <p className="p-4 text-sm leading-6 break-words">{data.detail}</p>
            </Card>
            <Card title="Suggested fix">
              <p className="p-4 text-sm leading-6 break-words">{data.fix}</p>
            </Card>
          </div>
          {data.subject && SQL_TYPES.has(data.type) && (
            <Card title="Query">
              <div className="p-4">
                <CodeBlock code={formatSql(data.subject)} />
              </div>
            </Card>
          )}
          <Card title="Sample transaction">
            <div className="p-4 text-sm">
              {data.sample ? (
                <p className="break-words">
                  Latest occurrence at {dateTime(data.sample.ts)} on <span className="break-all">{data.sample.url || data.route}</span>.{" "}
                  <Link to={traceLink(data.sample.transactionId)} className="link">
                    Open the trace
                  </Link>
                </p>
              ) : (
                <p className="text-muted">No sample is available.</p>
              )}
            </div>
            {data.recent.length > 1 && (
              <div className="border-t border-line">
                <h3 className="px-4 pt-3 text-sm font-semibold">Recent occurrences</h3>
                <ul className="divide-y divide-line px-4 pb-2 text-sm">
                  {data.recent.slice(0, 10).map((r) => (
                    <li key={`${r.transactionId}-${r.ts}`}>
                      <Link to={traceLink(r.transactionId)} className="link inline-flex min-h-10 items-center">
                        {dateTime(r.ts)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
