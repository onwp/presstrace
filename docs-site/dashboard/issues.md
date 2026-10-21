# Issues

The app checks every transaction against a set of rules when it arrives. Each match is stored as an issue event. The **Issues** page groups events of the same problem on the same route into one row.

![The Issues page with severity, type and route filters, and a table of issues with severity badge, title, subject, route, number of occurrences and when each was last seen](/screenshots/issues.png){.shot}

## The list

- **Severity**, **Type** and **Route** filter the list.
- Each row shows the severity, the title, what it is about (a query fingerprint, a host, a component or an error), the route (transaction name), how many times it happened in the range, and when it was last seen.
- The list shows 25 issues per page.

Issues are not opened or closed. An issue that stops happening drops out of the list once its last event is older than the time range. Events are kept as long as transactions (30 days by default).

## Issue detail

Click an issue to open it.

![The detail of a "Slow external request" issue with high severity: route admin-ajax dashboard-widgets, type, occurrences, first and last seen, slowest occurrence 4,770 ms; a "What is happening" text, a "Suggested fix" text, and a link to the trace of the latest occurrence](/screenshots/issue-detail.png){.shot}

- The header has the route, type, number of occurrences, first and last time it was seen, and the worst value (slowest time, highest count). All of them count only the selected time range, like the list.
- **What is happening** explains the problem with the numbers of one occurrence.
- **Suggested fix** says what to change in WordPress terms: which function to call, which cache to add, which setting to check.
- **Sample transaction** links to the trace of the latest occurrence.

Every rule, its thresholds and its fix text are in the [issues reference](/issues/).

![The issues list on a phone in the dark theme](/screenshots/issues-mobile-dark.png){.shot .shot-mobile}
