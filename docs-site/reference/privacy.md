# Data and privacy

PressTrace is self-hosted. Reports go from your WordPress sites to your own app and are stored in your own ClickHouse. Nothing is sent to the PressTrace authors or to any third party.

## What the agent sends

For each traced request, exactly the fields in the [payload format](/reference/payload):

- PHP and WordPress versions, PHP `memory_limit`, whether a persistent object cache is in use, and the query capture mode.
- A random transaction id, the time, the transaction name and type, HTTP method, URL without query string, HTTP status, timings, counts, peak memory and the sample rate.
- Whether a user was logged in, as `true` or `false`.
- For each query: the SQL text (cut to 2000 characters), duration, rows, error text, the calling component, and for queries of 1 ms or more a stack trace of file names, line numbers and function names.
- For each external call: the URL without query string, method, status, error text, component and stack trace.
- For each slow hook callback: the callback name, the hook, the file and line, and its time.
- Plugin and theme folder names with their load and self times.
- PHP errors: level, message, file, line and component.

## What the agent does not send

- Cookies, request or response headers, request bodies, form data and response bodies.
- Query strings of the page URL and of external call URLs.
- Visitor IP addresses and user agents.
- User IDs, names or emails. The report has only the logged-in flag.
- Function arguments in stack traces.

The app keeps only the fields it knows and ignores anything else in a report.

## What can still contain personal data

Look at these before you point PressTrace at a site with sensitive data:

- SQL text. Queries are stored with their real values, for example `SELECT * FROM wp_users WHERE user_email = 'jane@example.com'`. The fingerprint replaces values with `?`, but the full SQL is kept in the `spans` table so you can see it in a trace.
- Error messages. A plugin can put any data into a warning or exception message.
- URL paths. Query strings are removed, but paths like `/author/jane/` or a pretty search URL stay.

To remove or rewrite data before it leaves the site, use the [`presstrace_payload`](/plugin/developers#presstrace-payload) filter. To skip some requests entirely, use [`presstrace_should_trace`](/plugin/developers#presstrace-should-trace).

## What is stored where

| Where | What | How long |
|---|---|---|
| WordPress database | The `presstrace_settings` option: app URL, site key, monitoring flag, window, end time, sample rate. A `presstrace_sync_failed` transient for one hour when drop-ins cannot be written. | Until uninstall |
| WordPress temp folder | An empty `presstrace-backoff-*` file whose time marks the last failed send. | Until uninstall |
| ClickHouse `transactions` | One row per traced request. | `TRANSACTIONS_TTL_DAYS`, default 30 |
| ClickHouse `spans` | Queries (with SQL), external calls, callbacks, loads. | `SPANS_TTL_DAYS`, default 7 |
| ClickHouse `issue_events` | Issue matches with their texts. | `TRANSACTIONS_TTL_DAYS` |
| ClickHouse `errors` | PHP errors with message, file and line. | `TRANSACTIONS_TTL_DAYS` |
| ClickHouse `sites` | Name, URL, SHA-256 hash of the key, the first 7 and last 4 characters of the key. | Until removed |
| ClickHouse `query_fingerprints` | One row per site and query fingerprint (SQL with values replaced by `?`), for the Database page. | `SPANS_TTL_DAYS` |
| ClickHouse `revoked_sessions` | Random ids of signed-out sessions. No email or address. | Until the session would have expired, at most 7 days |
| App logs | Start-up, migration and error lines. No report data, SQL or site keys. | Three files of 10 MB per container |

On the site, the key is stored in plain text in the WordPress option or in `wp-config.php`, the same way WordPress stores other credentials. The app stores only its hash.

## Deleting data

Data expires on its own. Removing a site in the dashboard hides it and rejects its key, but its rows stay until they expire. To delete everything at once, stop the app and remove the ClickHouse volume (see [backups](/app/operations#backups) for the volume name).
