# API endpoints

The app has two groups of endpoints. Agent endpoints use a site key. Dashboard endpoints use the session cookie, and the dashboard itself calls them. They are not a stable public API yet, but you can script against them.

## Agent endpoints

Send `Authorization: Bearer <site key>`. A missing or unknown key gets `401 {"error":"Invalid or missing site key"}`.

| Method and path | What it does |
|---|---|
| `POST /api/v1/ingest` | Receives a report. See [payload format](/reference/payload). |
| `GET /api/v1/ping` | Checks the key. Returns the site id and name. |
| `GET /api/v1/debug/delay?ms=N` | Only with `ENABLE_DEBUG_ROUTES=1`, else `404`. Waits `N` ms (0 to 5000) and answers `{"ok":true,"ms":N}`. The lab uses it as a slow external service. |

Answers from `POST /api/v1/ingest`:

| Status | Body or meaning |
|---|---|
| `202` | `{"ok":true,"accepted":N}`. With `"rejected":M` when M transactions had a timestamp outside the window (older than the transaction retention or more than one hour ahead). |
| `400` | Invalid JSON, gzip or payload (`details` lists the problems), or every transaction was outside the time window. |
| `401` | Missing or unknown site key. |
| `413` | Over 2 MB before or after decompression. |
| `429` | With `Retry-After`. The site sent more than its rate limit, or the app's buffer is full while ClickHouse is busy. |
| `503` | With `Retry-After`. ClickHouse is failing or not answering and the app's buffer is full. |

The agent does not retry; it drops a report that gets anything other than `2xx`.

## Health

| Method and path | What it does |
|---|---|
| `GET /healthz` | `200 {"ok":true}` when ClickHouse answers a ping, else `503`. No auth. Used by the container health check. |

## Session

| Method and path | Body | What it does |
|---|---|---|
| `POST /api/auth/login` | `{"email":"...","password":"..."}` | Sets the `pt_session` cookie. `401` for wrong credentials, `429` after 5 failures in 15 minutes from one address or 50 from all addresses together, `413` over 16 KB. |
| `POST /api/auth/logout` | none | Clears the cookie and revokes the session, so a copy of the cookie stops working too. |
| `GET /api/auth/me` | none | Returns the admin email and `PUBLIC_URL`. |

Every request to `/api/*` outside `/api/v1/` needs the session cookie, except the login itself. Bodies over 64 KB get `413`. Requests other than `GET` and `HEAD` must come from the same origin (the request origin or `PUBLIC_URL`). Send an `Origin` header when you script them, or they get `403 {"error":"Cross-origin request refused"}`.

Example with curl:

```sh
APP=https://apm.example.com
curl -s -c cookies.txt -H "Origin: $APP" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}' "$APP/api/auth/login"
curl -s -b cookies.txt "$APP/api/sites?range=24h"
```

## Sites

| Method and path | What it does |
|---|---|
| `GET /api/sites?range=` | All sites with requests, avg, p50, p95, error rate, issues by severity, last seen and trend. |
| `POST /api/sites` | Body `{"name":"...","url":"https://..."}`. Returns `201` with the site and its `key`. The key is not returned again. |
| `GET /api/sites/:id` | One site with versions and last seen. |
| `PATCH /api/sites/:id` | Body `{"name":"...","url":"..."}`. Changes name and URL. |
| `POST /api/sites/:id/rotate` | New key. Returns the site and the new `key`. The old key stops working. |
| `DELETE /api/sites/:id` | Removes the site and rejects its key. |

## Site data

All take `range`: `30m`, `1h`, `2h`, `4h`, `12h`, `24h` or `7d`. An unknown value falls back to `1h`.

| Method and path | Extra parameters | Returns |
|---|---|---|
| `GET /api/sites/:id/transactions` | `type` | Summary, chart buckets and the transactions table. |
| `GET /api/sites/:id/wordpress` | | Components, callbacks and load times. |
| `GET /api/sites/:id/database` | | Queries by fingerprint and by component. |
| `GET /api/sites/:id/external` | | Hosts by method. |
| `GET /api/sites/:id/errors` | | Grouped errors. |
| `GET /api/sites/:id/issues` | `severity`, `type`, `route`, `page` | Grouped issues, 25 per page. |
| `GET /api/sites/:id/issues/:fingerprint` | | One issue in the range with its texts and latest sample. `404` when it did not happen in the range. |
| `GET /api/sites/:id/samples` | `by`, `key` | Slowest, p95, p50 and recent samples. `by` is `transaction`, `component`, `callback`, `query`, `external` or `error`. |
| `GET /api/sites/:id/traces/:transactionId` | | One trace with spans, errors and issues. Past the span retention the spans list is empty. `404` when the transaction itself is gone. |

An unknown site id gets `404 {"error":"Site not found"}`.
