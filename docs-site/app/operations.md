# Upgrades, backups and retention

## Upgrading

1. If you pinned `PRESSTRACE_VERSION` in `.env`, set it to the new version. Check the [release notes](https://github.com/onwp/presstrace-wordpress-apm/releases) for changes to `docker-compose.yml`, and copy the new file over if it changed.
2. Pull the new image and restart:

   ```sh
   docker compose pull
   docker compose up -d
   ```

   If you build from source, pull the new source and run `docker compose up -d --build` instead.

On start the app applies any new database migrations by itself. It records them in the `schema_migrations` table, so each runs once, and every step is safe to run again if a start is cut short.

On stop (`SIGTERM`) the app stops taking new connections, gives open requests up to 10 seconds to finish, and then writes the rows still in memory, for up to 15 more seconds. Compose waits 30 seconds (`stop_grace_period`) before it kills the container, so a normal restart loses no reports. If ClickHouse is down at that moment, the app logs how many rows it could not write. Reports that sites send while the app is down are dropped by the agents.

The ClickHouse version is pinned in `docker-compose.yml`. It only changes when a new PressTrace release changes that file.

To upgrade the plugin, see [Install the plugin](/plugin/#upgrading-the-plugin).

## Backups

All data lives in the Docker volume `clickhouse-data`. Compose names it `presstrace_clickhouse-data`. The `.env` file is the only other thing to keep, since it holds your passwords and secret.

A simple cold backup stops the stack and copies the volume into a tar file:

```sh
cd app
docker compose stop
docker run --rm \
  -v presstrace_clickhouse-data:/data:ro \
  -v "$PWD":/backup \
  alpine:3.22 tar cf /backup/presstrace-clickhouse.tar -C /data .
docker compose start
```

The archive is not compressed on purpose: ClickHouse data is already compressed, and gzip would only make the stop longer. The stack is down for as long as the copy takes, and that grows with the size of the volume: a 3.5 GB volume took about 30 seconds on a laptop SSD. Check the size first with the query under [sizing](/app/#sizing) and plan the backup for a quiet hour. While the app is stopped, agents drop their reports.

To restore into an empty volume:

```sh
docker compose down
docker volume rm presstrace_clickhouse-data
docker compose create clickhouse
docker run --rm \
  -v presstrace_clickhouse-data:/data \
  -v "$PWD":/backup \
  alpine:3.22 tar xf /backup/presstrace-clickhouse.tar -C /data
docker compose up -d
```

`docker compose create clickhouse` creates the volume the way Compose expects it, with its labels, without starting ClickHouse. A volume made with `docker volume create` works too, but Compose then warns that it did not create it.

The `sites` table is in the backup, with the hashes of the site keys. After a restore the WordPress sites keep working with their current keys.

Monitoring data is short-lived, so many teams back up only `.env` and accept that a lost volume means starting again with new site keys.

## Retention

| Data | Variable | Default |
|---|---|---|
| Transactions, issue events, errors | `TRANSACTIONS_TTL_DAYS` | 30 days |
| Spans (queries, external calls, callbacks, load times) and query fingerprints | `SPANS_TTL_DAYS` | 7 days |

On each start the app compares the table TTLs with these values and runs `ALTER TABLE ... MODIFY TTL` when they differ. The log then shows a line such as `Retention for spans set to 14 days`. The tables use `materialize_ttl_recalculate_only`, so a change only recalculates the expiry of each part instead of rewriting every row, and it stays quick on big tables.

Agents can only send transactions with a timestamp between the transaction retention ago and one hour ahead of the app's clock. Others are left out of the report, and the response says how many (`rejected`). A WordPress server whose clock is far off shows up as reports that are accepted but have no data.

Tables are split into one partition per day, and ClickHouse drops whole parts once every row in them has expired. Old data can stay up to about a day past its TTL.

A trace older than the span retention still has its transaction row but no timeline, and the trace page says so.

## Deleting a site

Removing a site in the dashboard hides it and rejects its key right away. Its stored data is not deleted and expires with the normal retention.

## When ClickHouse is slow or down

The app keeps reports in memory and writes them to ClickHouse about once a second. If a write fails or hangs, the rows stay in memory and the app tries again after 1 second, then 2, 4 and so on up to 30 seconds. Nothing is lost while the buffer has room (`BUFFER_MAX_MB`, 64 MB by default). At about 50 reports per second the buffer lasts about 20 seconds.

When the buffer is full, new reports are refused:

- `503` with `Retry-After: 30` when ClickHouse is failing or not answering.
- `429` with `Retry-After: 5` when ClickHouse works but cannot keep up.

The agent drops a refused report. Once ClickHouse is back, the app writes the buffer and starts accepting reports again within a few seconds. Every row that got a `202` is stored once: a retried write carries the same deduplication token, so ClickHouse ignores it if the first attempt went through after all.

## Health check

`GET /healthz` answers `200 {"ok":true}` when ClickHouse answers a ping, and `503 {"ok":false}` when it does not. It needs no sign-in. The app image checks it every 10 seconds, and Docker marks the container `unhealthy` after 5 failures in a row. That status shows in `docker compose ps`. Docker does not restart a container only because it is unhealthy, so use it in your monitoring. `restart: unless-stopped` restarts the app when the process exits.

A failing health check usually means ClickHouse is down or overloaded, not the app. The app keeps accepting reports into its buffer while that lasts, as described above.

## Logs

```sh
docker compose logs -f app
docker compose logs -f clickhouse
```

The app writes one JSON object per line, with `time`, `level` (`info`, `warn` or `error`) and `msg`, plus a few fields. For example:

```json
{"time":"2026-10-20T16:56:25.895Z","level":"info","msg":"Listening on http://0.0.0.0:8080","publicUrl":"https://apm.example.com"}
{"time":"2026-10-20T17:08:44.690Z","level":"warn","msg":"ClickHouse inserts failing, keeping rows in memory and retrying","table":"transactions","failedAttempts":1,"retryInMs":1000,"bufferedBytes":3334725,"reason":"ECONNREFUSED"}
```

It logs start-up steps, migrations, retention changes, and problems writing to ClickHouse. A ClickHouse outage gives one line when writes start failing, one a minute while it lasts, and one when writes recover. Logs never contain report data or SQL: ClickHouse errors appear only as their code and name, such as `ClickHouse error 252 TOO_MANY_PARTS`. Settings errors at start are printed as plain text, so they are easy to read in a terminal. ClickHouse itself logs only warnings and errors.

Compose keeps at most three log files of 10 MB per container (`json-file` driver with `max-size` and `max-file`), so logs cannot fill the disk.
