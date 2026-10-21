# Troubleshooting

## The app does not start

Run `docker compose logs app`.

| Message | Fix |
|---|---|
| `ADMIN_PASSWORD is not set` or `must be at least 12 characters long` | Set `ADMIN_PASSWORD` in `.env`. |
| `ADMIN_PASSWORD is a placeholder or a well-known weak password` | Replace it with a random one, for example the output of `openssl rand -base64 18`. |
| `SESSION_SECRET looks like a placeholder or is not random` | Set it to the output of `openssl rand -hex 32`. |
| `PUBLIC_URL uses plain http on a non-local host` (warning) | Put HTTPS in front of the app and set `PUBLIC_URL` to the `https://` address. See [HTTPS](/app/https). |
| `SESSION_SECRET is not set` or `must be at least 32 characters long` | Set it to the output of `openssl rand -hex 32`. |
| `PUBLIC_URL must be an absolute URL` | Use a full address such as `https://apm.example.com`. |
| `TRANSACTIONS_TTL_DAYS must be an integer between 1 and 3650` | Fix the value. The same check applies to `SPANS_TTL_DAYS` and `PORT`. |
| `Set CLICKHOUSE_PASSWORD in .env` (from Compose) | Set `CLICKHOUSE_PASSWORD`. |
| `Waiting for ClickHouse` and nothing after it | ClickHouse is not healthy yet. Check `docker compose logs clickhouse`. |
| `BUFFER_MAX_MB must be an integer between 1 and 4096` | Fix the value. The same kind of check applies to `INGEST_RATE_PER_SITE` and `INGEST_BURST_PER_SITE`. |

## Test connection fails in WordPress

The message on **Tools > PressTrace** tells you which case you are in.

| Message | Meaning and fix |
|---|---|
| `Save an app URL and a site key first.` | Save the settings, or define both constants. |
| `Could not reach the app: ...` | WordPress cannot open a connection to the app URL. Check DNS, the port, a firewall, and that the URL is reachable from the WordPress server itself (not only from your laptop). A WordPress site in Docker cannot reach `localhost` on the host: use the host address, such as `host.docker.internal`. |
| `The app rejected the site key (HTTP 401). Copy the key again from the app.` | The key is wrong, was rotated, or the site was removed. Rotate the key in the app and paste the new one. |
| `Unexpected response from the app (HTTP ...). Check the app URL.` | The URL points to something that is not the PressTrace app, for example a path or a proxy error page. |

The settings page also refuses a key that is not `pt_` followed by 40 hexadecimal characters, and keeps the previous key.

## Test connection works but no data arrives

- Is monitoring on? The status box on **Tools > PressTrace** says `Monitoring on`. If it says `The monitoring window ended on ...`, save the settings to start a new window.
- Is the sample rate 0? Then nothing is traced.
- Was the app down or slow a moment ago? After a failed send the agent waits 60 seconds before it sends again.
- Are you only testing as a logged-in admin with `?presstrace_force=1`? That works even when monitoring is off, but only for users with the `manage_options` capability.
- Is the app overloaded or ClickHouse down? When the write buffer is full (`BUFFER_MAX_MB`), the app answers `503` if ClickHouse is failing and `429` if it is busy, and the agent drops the report. A site that sends more than 20 reports per second also gets `429`. Check `docker compose logs app` for `ClickHouse inserts failing`.
- Is the WordPress server's clock right? Transactions more than one hour ahead of the app's clock, or older than the retention, are not stored. The ingest response then has a `rejected` count.
- Check the time range at the top of the dashboard. The default is the last hour.

## Query times are missing

If the Database page shows query counts but no times, another `db.php` drop-in is installed and `SAVEQUERIES` is off. See [drop-ins and compatibility](/plugin/drop-ins#when-another-db-php-exists).

## Too many failed sign-ins

After 5 failed sign-ins from one address within 15 minutes, or 50 from all addresses together, the app answers `Too many failed attempts. Try again in 15 minutes.` Wait, or restart the app container, which clears the counters. Behind a reverse proxy, set `TRUST_PROXY=true`, or all users share the proxy's address.

## Signed out after a change

Changing `ADMIN_PASSWORD` or `SESSION_SECRET` signs every session out, by design. Sign in again with the new password.

## Everything is slow after an outage

If the app is down or hanging, each PHP worker waits at most 2 seconds once and then skips sending for 60 seconds, so an outage should not slow the site down. If you see longer waits, check that PHP-FPM or LiteSpeed is in use. With other setups the response cannot be finished early, and the timeout is 0.5 seconds per traced request.
