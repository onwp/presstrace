import { Link } from "react-router";
import type { SampleBy, SamplesResponse } from "../../shared/types";
import { dateTime, ms, num } from "../lib/format";
import { useApi, useRange } from "../lib/hooks";
import { useSite } from "./Layout";
import { EmptyState, ErrorBox, Loading, Modal } from "./ui";

export interface SampleTarget {
  by: SampleBy;
  key: string;
  title: string;
  description: string;
}

/** Representative samples (slowest, p95, p50) and the most recent transactions for one entity. */
export function SamplesDialog({ target, onClose }: { target: SampleTarget | null; onClose: () => void }) {
  const site = useSite();
  const [range] = useRange();
  const path = target
    ? `/api/sites/${site.id}/samples?range=${range}&by=${target.by}&key=${encodeURIComponent(target.key)}`
    : null;
  const { data, error, loading, reload } = useApi<SamplesResponse>(path);
  const traceLink = (id: string) => `/sites/${site.id}/traces/${id}?range=${range}`;
  // For transaction samples the value is the duration itself, so one column is enough.
  const showValue = target?.by !== "transaction";

  return (
    <Modal open={target !== null} onClose={onClose} title={target?.title ?? ""} wide>
      {target && <p className="mb-4 text-sm text-muted break-words">{target.description}</p>}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading label="Loading samples" />}
      {data && data.recent.length === 0 && data.highlights.length === 0 && (
        <EmptyState title="No samples in this time range">
          Choose a longer time range. Span details are kept for a shorter time than transactions.
        </EmptyState>
      )}
      {data && data.highlights.length > 0 && (
        <ul className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {data.highlights.map((h) => (
            <li key={h.label} className="rounded-md border border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{h.label} sample</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{ms(h.sample.value)}</p>
              <p className="text-xs text-muted">
                {data.label}, transaction {ms(h.sample.duration)}
              </p>
              <p className="mt-1 text-sm break-words">{h.sample.name}</p>
              <p className="text-xs text-muted">{dateTime(h.sample.ts)}</p>
              <Link to={traceLink(h.sample.transactionId)} className="link mt-2 inline-flex min-h-10 items-center text-sm">
                Open trace<span className="sr-only"> for the {h.label} sample</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.recent.length > 0 && (
        <>
          <h3 className="mb-2 font-semibold">Recent samples</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Recent transactions</caption>
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th scope="col" className="px-2 py-2">Time</th>
                  <th scope="col" className="px-2 py-2">Transaction</th>
                  <th scope="col" className="px-2 py-2">URL</th>
                  {showValue && <th scope="col" className="px-2 py-2 text-right">{data.label}</th>}
                  <th scope="col" className="px-2 py-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((s) => (
                  <tr key={s.transactionId} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link to={traceLink(s.transactionId)} className="link inline-flex min-h-10 items-center">
                        {dateTime(s.ts)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 break-words">{s.name}</td>
                    <td className="max-w-[16rem] truncate px-2 py-2" title={s.url}>
                      {s.url}
                    </td>
                    {showValue && (
                      <td className="px-2 py-2 text-right tabular-nums">{target?.by === "error" ? num(s.value) : ms(s.value)}</td>
                    )}
                    <td className="px-2 py-2 text-right tabular-nums">{ms(s.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
