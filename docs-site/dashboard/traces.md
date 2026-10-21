# Samples and traces

## Samples

Most rows in the dashboard open a samples dialog: a transaction, a plugin, a callback, a query, an external host or an error. It shows real requests that match the row.

![The samples dialog for front-page: three cards for the slowest sample, one near the 95th percentile and one near the median, each with an "Open trace" link, and a table of recent samples](/screenshots/samples.png){.shot}

- **Slowest sample**, **p95 sample** and **p50 sample** are the requests closest to those values in the range. Compare the slowest with the median to see what goes wrong on bad requests.
- **Recent samples** lists the latest matching requests.

For an error, the dialog shows recent requests that raised it.

Click **Open trace** or a time to open the trace of that request. Escape closes the dialog.

## Trace

A trace is one request in full detail.

![A trace of a front-page request: duration, status, type, query count, external calls and peak memory at the top, a "Where the time went" bar split into PHP, MySQL and external time, the issues found in this request, and the timeline sorted by duration](/screenshots/trace.png){.shot}

At the top:

- Duration, HTTP status, type, number of queries and external calls, and peak memory compared with the PHP `memory_limit`.
- Time, PHP version, WordPress version, whether a user was logged in, and the transaction id.
- **Where the time went**: the split between PHP, MySQL and external calls.
- **Issues found in this request**: every [issue](/issues/) the rules raised for it, with a link to the issue.

## Timeline

The timeline lists every span: plugin and theme loads, queries, hook callbacks of 1 ms or more, and external calls. Each bar starts where the span started and is as wide as it took.

- **Kind** filters by span type.
- **Sort by** switches between start time and duration.
- Spans that take more than 5% of the request are marked `Over 5%`, and spans over 25% are marked `Over 25%` in red.

A request can have at most 500 spans. When the agent recorded more, it kept the slowest, and the trace says how many were dropped, for example `500 spans, 1065 more were dropped by the agent.`

Spans are kept for 7 days by default and transactions for 30. A trace older than the span retention still shows its totals, with a note that explains why the timeline is empty.

## Span details

Click a span to open its details on the right.

![The span detail panel of an external call: kind, duration, share of the transaction, start time, component (the presstrace-lab-scenarios plugin), URL, method, status 200, and a stack trace that leads from index.php through do_action to wp_remote_get](/screenshots/trace-span.png){.shot}

| Span kind | Details |
|---|---|
| Query | SQL, fingerprint, rows, error, component, stack trace (for queries of 1 ms or more) |
| External request | URL without query string, method, status (or `No response`), error, component, stack trace |
| Callback | Hook, self time, file and line, component |
| Plugin or theme load | Component |

The stack trace runs from the code that made the call down to the WordPress entry point. Paths are relative to the WordPress root.

## Dark theme and phones

<div class="shot-row">

![The same trace on a 390 pixel wide phone](/screenshots/trace-mobile.png){.shot .shot-mobile}

</div>

![The trace page in the dark theme](/screenshots/trace-dark.png){.shot}
