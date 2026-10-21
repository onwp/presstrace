# How it works

<svg class="diagram" viewBox="0 0 780 250" role="img" aria-labelledby="dia-title dia-desc" xmlns="http://www.w3.org/2000/svg">
  <title id="dia-title">PressTrace architecture</title>
  <desc id="dia-desc">A visitor requests a page from WordPress. The PressTrace plugin measures the request. After the page is sent, the plugin posts a gzipped report to the PressTrace app at /api/v1/ingest. The app checks the key, validates the report, detects issues and writes rows to ClickHouse. The dashboard in your browser reads from the app.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path class="arrowhead" d="M0 0 L10 5 L0 10 z" />
    </marker>
  </defs>
  <rect class="box" x="10" y="80" width="110" height="60" rx="8" />
  <text x="65" y="115" text-anchor="middle">Visitor</text>

  <rect class="accent" x="170" y="40" width="190" height="140" rx="8" />
  <text x="265" y="68" text-anchor="middle">WordPress site</text>
  <text class="small" x="265" y="98" text-anchor="middle">mu-plugin loader</text>
  <text class="small" x="265" y="120" text-anchor="middle">PressTrace plugin</text>
  <text class="small" x="265" y="142" text-anchor="middle">db.php drop-in</text>
  <text class="small" x="265" y="164" text-anchor="middle">only settings in the DB</text>

  <rect class="accent" x="420" y="40" width="170" height="140" rx="8" />
  <text x="505" y="68" text-anchor="middle">PressTrace app</text>
  <text class="small" x="505" y="98" text-anchor="middle">check site key</text>
  <text class="small" x="505" y="120" text-anchor="middle">validate report</text>
  <text class="small" x="505" y="142" text-anchor="middle">detect issues</text>
  <text class="small" x="505" y="164" text-anchor="middle">batch writes</text>

  <rect class="box" x="640" y="40" width="130" height="60" rx="8" />
  <text x="705" y="75" text-anchor="middle">ClickHouse</text>
  <rect class="box" x="640" y="140" width="130" height="60" rx="8" />
  <text x="705" y="175" text-anchor="middle">Your browser</text>

  <path class="line" d="M120 110 H166" marker-end="url(#arrow)" />
  <text class="small" x="143" y="100" text-anchor="middle">page</text>
  <path class="line" d="M360 110 H416" marker-end="url(#arrow)" />
  <text class="small" x="388" y="100" text-anchor="middle">report</text>
  <text class="small" x="388" y="132" text-anchor="middle">after</text>
  <text class="small" x="388" y="146" text-anchor="middle">response</text>
  <path class="line" d="M590 75 H636" marker-end="url(#arrow)" />
  <path class="line" d="M636 170 H594" marker-end="url(#arrow)" />
  <text class="small" x="612" y="218" text-anchor="middle">dashboard</text>
</svg>

## The pieces

The plugin (`plugin/presstrace`) is the agent. On activation it copies a small loader to `wp-content/mu-plugins/000-presstrace.php` so it starts before other plugins. It also installs `wp-content/db.php` to time every query, but only when no other `db.php` exists. See [drop-ins](/plugin/drop-ins).

The app (`app/`) is a Node.js 24 server built with Hono. It serves the ingest API and the dashboard (a React app) from one process on port 8080.

ClickHouse is the database. The app creates these tables on first start:

| Table | Holds | Default retention |
|---|---|---|
| `sites` | Site id, name, URL, a SHA-256 hash of the site key | Kept until you delete the site |
| `transactions` | One row per traced request, with totals and per-plugin times | 30 days |
| `spans` | Queries, external calls, callbacks and load times | 7 days |
| `issue_events` | One row each time a rule matches a request | 30 days |
| `errors` | PHP errors with level, message, file, line and component | 30 days |

Issues are never updated in place. The Issues page groups `issue_events` by fingerprint.

## What happens on one request

1. Start: The loader reads the settings and decides whether to trace. It skips the request when the plugin is not configured, monitoring is off or its window has ended, or the request is not picked by the sample rate. WP-CLI is skipped unless you [turn it on](/plugin/constants). Requests made by PressTrace itself and `/favicon.ico` are never traced.
2. Measure: On a traced request the agent:
   - times every query through its `db.php` drop-in (or a fallback when another drop-in is installed),
   - wraps the hook callbacks of plugins and themes in place, so `remove_action()` and `has_filter()` still work,
   - measures plugin load times between `mu_plugin_loaded` and `plugin_loaded`, and theme setup between `setup_theme` and `after_setup_theme`,
   - pairs external calls through the `http_request_args` and `http_api_debug` hooks,
   - chains its own PHP error and exception handlers in front of the existing ones and checks for a fatal error at shutdown.

   The request start time is `$_SERVER['REQUEST_TIME_FLOAT']`, so the time before WordPress loaded is counted too.
3. Finish the response: In a shutdown function the agent calls `fastcgi_finish_request()` (or `litespeed_finish_request()`). The visitor gets the page before any report is sent.
4. Send: The agent builds one report of at most 500 spans. When there are more, it keeps the slowest and counts the rest as dropped. It gzips the report and POSTs it to `{app_url}/api/v1/ingest` with the site key. The timeout is 2 seconds, or 0.5 seconds when the response could not be finished early. The agent does not queue a failed send. It drops it, and after a connection failure or timeout it skips sending for 60 seconds.
5. Ingest: The app looks up the site by the hash of its key, unpacks the body (2 MB limit), validates it, removes query strings and credentials from URLs, and computes a fingerprint for each SQL query. Then it runs the [detection rules](/issues/) and answers `202`.
6. Store: Rows wait in memory and are written to ClickHouse in batches about once a second. If ClickHouse falls far behind and 200,000 rows are waiting, new reports get `429` and are dropped.
7. Read: The dashboard queries ClickHouse through the app. Request counts and rates are scaled by `1 / sample_rate`, so a site sampled at 0.1 still shows its real traffic.

## Why it is cheap when idle

When the agent is dormant it reads one option and returns, without wrapping hooks or installing handlers. On a traced request most of the cost is the per-query and per-callback timing. See [overhead](/reference/overhead) for measured numbers.
