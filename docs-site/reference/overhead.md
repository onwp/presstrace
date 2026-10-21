# Overhead

PressTrace runs inside your PHP process, so it adds some time to each request. The cost is small when a request is not traced and moderate when it is.

## Measured numbers

From the lab (WordPress 7.1.3, PHP 8.3, PHP-FPM, WooCommerce and Query Monitor active), with a page that takes about 60 ms without PressTrace:

| State | Added time per request |
|---|---|
| Plugin active, monitoring off or request not sampled | about 0 to 3 ms |
| Request traced | about 9 to 12 ms |

The report is sent after the response is finished, so the visitor does not wait for it. The PHP worker stays busy until the send ends or times out.

When the app is unreachable:

| App state | Median page time in the lab |
|---|---|
| App up | 84 ms |
| App stopped (connection refused) | 90 ms |
| App hanging | One request of 785 ms in the first 2 seconds, then 67 to 97 ms |
| Wrong site key (`401`) | 78 ms |

When the app hangs, the first failed send holds one PHP worker for the 2-second timeout. After that the agent skips sending for 60 seconds, so an outage does not fill the PHP-FPM pool.

## Where the cost comes from

- Idle: the loader reads one option and decides not to trace. No hooks are wrapped.
- Traced: each query and each wrapped hook callback is timed, stack traces are built for queries of 1 ms or more, and the report is encoded and gzipped at shutdown. Pages with thousands of queries or callbacks cost more than simple pages.

## Sampling advice

- Use `1` while you investigate a problem, with a monitoring window, so it turns itself off.
- For sites you watch all the time, start at `0.1`. One request in ten pays the tracing cost and the rest pay almost nothing. The dashboard scales counts, so it still shows the real traffic.
- Very busy sites can go lower, for example `0.01`. Averages and percentiles stay meaningful as long as each transaction you care about gets enough samples in your time range.
- Use [`?presstrace_force=1`](/plugin/settings#trace-one-request) to trace one request on demand without changing the sample rate.

Measure on your own site: compare the p50 on the Transactions page with monitoring on, and your normal page time from the server logs with monitoring off.
