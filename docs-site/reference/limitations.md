# Known limitations

## What the agent cannot see

- Queries that bypass `$wpdb`, such as direct `mysqli` or PDO calls, are not recorded as spans. Their time shows in the self time of the plugin that ran them.
- HTTP calls that bypass the WordPress HTTP API, such as raw cURL, Guzzle or `file_get_contents()`, are not recorded as spans. Their time also shows in the plugin's self time.
- Core hook callbacks are not timed one by one. Their time counts as PHP time.
- Callbacks that take arguments by reference are not wrapped, so they are not timed on their own.
- Requests served by a full page cache never reach WordPress and are not traced.
- Errors are only recorded on traced requests, and at most 50 different errors per request.

## Data limits

- At most 500 spans per request. When there are more, the slowest 500 are kept and the trace shows how many were dropped.
- SQL is cut to 2000 characters.
- Stack traces have at most 15 frames, and only queries of 1 ms or more get one.
- Hook callbacks shorter than 1 ms are only counted in their component's total.
- Reports are never queued or retried. If the app is down, data from that time is lost. After a failed send, the agent also skips the next 60 seconds.

## Running the app

Run exactly one app container per ClickHouse database. Several app containers behind a load balancer do not work correctly, because some state lives in the memory of each app process:

- The write buffer. Each process batches its own rows, so more processes mean more, smaller inserts and more parts in ClickHouse.
- The login limits and the ingest rate limit per site. Each process counts on its own, so the limits would be multiplied by the number of processes.
- Revoked sessions. A process reads the list of signed-out sessions only at start, so a cookie that was signed out on one process still works on the others until they restart.
- The site list and keys. Each process reloads them every 60 seconds, so a rotated or removed key keeps working on other processes for up to a minute.
- Migrations. Every process runs them at start, with no lock between processes.

One process handled about 500 traced requests per second with 80 spans each in the load test (see [sizing](/app/#sizing)), which is far more than most fleets send. Scale up the server instead of adding app containers.

Rows wait in memory for up to about a second before they are written. A normal stop writes them first, but a crash or a kill (for example the kernel's out-of-memory killer) loses them. While ClickHouse is down the app keeps up to `BUFFER_MAX_MB` (64 MB) of reports and refuses more with `503`.

Transactions with a timestamp older than the transaction retention or more than one hour ahead of the app's clock are not stored.

## Side effects

- Code that reads `WP_Hook::$callbacks` directly sees PressTrace wrapper objects on traced requests. The original callback is available with `get_wrapped_callback()`.
- With another `db.php` installed and `SAVEQUERIES` off, queries are counted but not timed.
- Replacing `db.php` from WP-CLI does not clear PHP-FPM's opcache, so the previous drop-in can stay in use until PHP-FPM reloads. Activation from wp-admin does clear it.
- The 0.5-second send timeout, used when the response cannot be finished early (no PHP-FPM or LiteSpeed), was checked in code only.

## Detection

- N+1 detection needs at least two different SQL strings. Identical repeats are reported as a duplicate query.
- WooCommerce on a site without a persistent object cache raises "Options loaded one by one" on most pages. It is low severity, and the fix is a persistent object cache.
- Thresholds are fixed and cannot be changed in settings.

## Dashboard

- There is one admin user, with no roles or teams.
- There are no alerts, no email or Slack notifications and no export to other APM tools.
- Multisite has no network-wide agent.
- The first bar of a chart can be partial, because the range start is not aligned to the bar size.
- The app refreshes its site list from ClickHouse every 60 seconds. Changes made through the app apply at once.
