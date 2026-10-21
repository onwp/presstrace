# Architecture

PressTrace has two parts: a WordPress plugin that measures requests, and a self-hosted app that stores the measurements and shows them. They talk over one HTTP endpoint.

```text
WordPress site + plugin  --(gzipped JSON, one report per traced request)-->  app (Node.js)  -->  ClickHouse
```

One app can serve many WordPress sites. Each site has its own key.

## Plugin

The plugin lives in `plugin/presstrace`. It is plain PHP (7.4 or newer, WordPress 6.0 or newer) and needs no PHP extension.

### Bootstrap

On activation the plugin writes two drop-ins:

- `wp-content/mu-plugins/000-presstrace.php` loads the agent before other plugins, so it can time how long each plugin takes to load.
- `wp-content/db.php` replaces `wpdb::query()` to time every query. The plugin writes it only when no other `db.php` exists, and removes it on deactivation only if the file is still its own.

The agent uses `$_SERVER['REQUEST_TIME_FLOAT']` as the request start. It stays dormant unless it has an app URL and site key, monitoring is on and inside its window (2, 4, 12 or 24 hours, or always), and the request passes the sample rate.

### What it records

- The transaction name and type. Front-end requests are named after the template (`single-product`, `archive-post`, `404`), admin requests after the screen, REST requests after the matched route, and AJAX requests after the action. Types are `frontend`, `admin`, `rest`, `ajax`, `cron` and `cli`. CLI tracing is off by default.
- Totals: duration, MySQL time, external HTTP time, PHP time (the rest), query and call counts, peak memory and HTTP status.
- Spans, capped at 500 per transaction:
  - `db`: each query, with the calling plugin or theme. SQL is cut at 2,000 characters, and queries of 1 ms or more keep a stack trace. When another `db.php` is installed, the agent reads timings through Query Monitor's `log_query_custom_data` filter, then `SAVEQUERIES`, and otherwise only counts queries.
  - `http`: calls made through the WordPress HTTP API, matched through `http_request_args` and `http_api_debug`. The URL is stored without its query string.
  - `plugin_load` and `theme_load`: time between the `mu_plugin_loaded`, `plugin_loaded` and theme setup hooks.
  - `callback`: plugin and theme hook callbacks. The agent wraps entries of `WP_Hook::$callbacks` in place, keeping the same index so `remove_filter()` still works. Callbacks that take arguments by reference are not wrapped. Callbacks of 1 ms or more get their own span; shorter ones are summed per plugin or theme.
- PHP errors, through chained error and exception handlers and a fatal error check at shutdown, each tied to the plugin or theme it came from.

### Sending

At shutdown the agent calls `fastcgi_finish_request()` (or `litespeed_finish_request()`) so the visitor gets the page first, then posts the gzipped report to `{app_url}/api/v1/ingest` with the site key as a bearer token. The timeout is 2 seconds, or 0.5 seconds when the response could not be flushed early. Failed reports are dropped, not queued. After a failed send the agent skips sending for 60 seconds, so an app outage does not hold every PHP worker for the full timeout. The plugin never writes trace data to the WordPress database; it stores only its settings there.

The payload format is described in the [payload reference](https://onwp.github.io/presstrace/reference/payload).

## App

The app lives in `app/`. Docker Compose runs two containers:

- `app`: Node.js 24 with a Hono server. The same process serves the ingest API, the JSON API for the dashboard, and the React dashboard.
- `clickhouse`: the official ClickHouse image.

The ingest API checks the site key, validates the payload, runs issue detection, and buffers rows in memory. Rows are written to ClickHouse in batches. If ClickHouse is slow or down, the buffer holds up to `BUFFER_MAX_MB` of data before new reports are refused.

The dashboard has a single admin login, configured with environment variables, and a signed session cookie.

### Data model

| Table | Engine | Holds |
|---|---|---|
| `sites` | ReplacingMergeTree | Site name, URL and the SHA-256 hash of its key. |
| `transactions` | MergeTree, daily partitions | One row per traced request: name, type, URL, status, timings, counts, memory, versions. |
| `spans` | MergeTree, daily partitions | Queries, external calls, plugin loads and callbacks, linked to their transaction. |
| `issue_events` | MergeTree, daily partitions | One row each time a detection rule matches a transaction. |
| `errors` | MergeTree, daily partitions | PHP errors with level, message, file, line and component. |
| `query_fingerprints` | ReplacingMergeTree | Normalized SQL per fingerprint. |
| `revoked_sessions` | ReplacingMergeTree | Sessions ended by sign-out, until they expire. |

`transactions`, `issue_events` and `errors` expire after `TRANSACTIONS_TTL_DAYS` (30 by default). `spans` and `query_fingerprints` expire after `SPANS_TTL_DAYS` (7 by default). The app applies migrations and TTL changes when it starts.

### Issue detection

Detection runs at ingest, one transaction at a time. Each match is stored as a row in `issue_events`, never updated. The Issues page groups those rows by fingerprint. The rules cover N+1 and duplicate queries, too many queries, slow queries, `SELECT *` from plugins, slow and failed external calls, slow transactions, slow plugins, PHP errors and high memory use. The thresholds are listed in the [issues reference](https://onwp.github.io/presstrace/issues/).

## Design choices

- No PHP extension. Everything the agent measures comes from WordPress hooks, the `db.php` drop-in and PHP's own handlers. This keeps the plugin installable on shared hosting, at the cost of missing queries that bypass `$wpdb` and HTTP calls that bypass the WordPress HTTP API. That time still shows up in the self time of the plugin that made the call.
- Send after the response. The report goes out after the page is delivered, and failures are dropped. Visitors never wait for the APM, and an outage loses data instead of slowing the site.
- Append-only storage. Transactions, spans, errors and issue events are only inserted. Aggregates are computed at query time, which suits ClickHouse and keeps ingest simple.
- Detection in the app. The plugin sends raw measurements, and the app applies the rules, so rule changes need no plugin update.
- Self-hosted only. The app is one Compose file with no external services. Data stays on the operator's server.
