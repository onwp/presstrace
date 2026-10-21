# Install the app

The app is two containers started by Docker Compose:

- `clickhouse`: the official `clickhouse/clickhouse-server` image (version 26.8.31.2). It stores all data in the Docker volume `clickhouse-data`.
- `app`: the image `ghcr.io/onwp/presstrace`, built from `app/Dockerfile` on Node.js 24. It serves the dashboard and the ingest API on port 8080 inside the container. Images are published for `linux/amd64` and `linux/arm64`.

## Requirements

- Docker with the Compose plugin (`docker compose`).
- A Linux server, VM or laptop. The defaults are tuned for a VPS with 2 GB of RAM. See [sizing](#sizing) for larger servers.
- A way for your WordPress servers to reach the app. Compose publishes port 8080 on `127.0.0.1` only, so put a reverse proxy with HTTPS in front (see [HTTPS](/app/https)), or set `APP_BIND=0.0.0.0` to open the port on every interface.

## Sizing

### Memory

The defaults fit a server with 2 GB of RAM:

| Container | Limit | Variable | Measured use |
|---|---|---|---|
| `clickhouse` | `1200m` | `CLICKHOUSE_MEM_LIMIT` | 150 to 450 MB under load |
| `app` | `384m` | `APP_MEM_LIMIT` | 50 to 90 MB at 500 requests per second, 140 MB with a full write buffer |

ClickHouse is told to use at most 60% of its container limit (about 720 MB), and each query at most 400 MB (`max_memory_usage` in `clickhouse/users.d/presstrace.xml`). The app gives Node.js a heap of 75% of its limit and keeps at most 64 MB of reports in memory while ClickHouse is slow or down (`BUFFER_MAX_MB`). That leaves about 400 MB for the operating system and the proxy.

For a server with 4 GB or more, or a site with many traced requests per day, raise the limits in `.env`:

```sh
CLICKHOUSE_MEM_LIMIT=3000m
APP_MEM_LIMIT=768m
BUFFER_MAX_MB=128
```

and in `clickhouse/users.d/presstrace.xml` set `max_memory_usage` to `1000000000`, `max_bytes_before_external_group_by` and `max_bytes_before_external_sort` to `500000000`, and `max_threads` to `4`. Dashboard pages over 7 days on a busy site get faster with more threads and memory for ClickHouse.

### Throughput

One app container is enough for most fleets. In a load test on an Apple M1 Pro laptop with Docker Desktop and the 2 GB defaults, each request carrying one transaction with 80 spans:

| Requests per second | Result |
|---|---|
| 50, 100, 200, 500 | Every report accepted and stored, no trace with missing spans, p99 under 50 ms |
| 650 | About 6% refused with `429` |
| 800 | The app process used a full CPU core and refused about 60% with `429` |

So plan for about 500 traced requests per second (40,000 spans per second, about 43 million traced requests per day) per app container on comparable hardware. The limit is the CPU of the single Node.js process. A server with slower cores handles less. Use [sampling](/plugin/settings#sample-rate) before you get close.

### Disk

Disk use depends on traffic, spans per request and retention. Measured per row on disk:

| Row | Size |
|---|---|
| Span | about 41 bytes |
| Transaction | about 100 bytes |
| Issue event | about 48 bytes |

A traced request with 80 spans takes about 3.3 KB of spans and about 0.35 KB for its transaction row and issue events, so 3.5 to 5 KB in total. Spans are kept 7 days and the rest 30 days by default, so once the retention is full the disk use is about:

```text
traced requests per day x (7 x 3.3 KB + 30 x 0.35 KB)
```

| Traced requests per day | Disk with default retention |
|---|---|
| 10,000 | about 340 MB |
| 100,000 | about 3.4 GB |
| 1,000,000 | about 34 GB |

Requests with fewer spans take less. Check real usage after a few days:

```sh
docker compose exec clickhouse clickhouse-client -d presstrace -q \
  "SELECT table, formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE active GROUP BY table"
```

Sampling lowers both CPU on the WordPress side and disk on the app side. See [sampling](/plugin/settings#sample-rate).

## Install with Docker Compose

1. Get the Compose files. Each [GitHub release](https://github.com/onwp/presstrace/releases) has a `presstrace-app-<version>.tar.gz` with `docker-compose.yml`, `.env.example` and the ClickHouse config:

   ```sh
   VERSION=0.1.0   # the version of the latest release
   curl -fsSLO "https://github.com/onwp/presstrace/releases/download/v$VERSION/presstrace-app-$VERSION.tar.gz"
   tar -xzf "presstrace-app-$VERSION.tar.gz"
   cd presstrace-app
   ```

   To check that the file was built by the PressTrace release workflow from this repository, run `gh attestation verify "presstrace-app-$VERSION.tar.gz" -R onwp/presstrace` (needs the [GitHub CLI](https://cli.github.com/)). Each release also has a `SHA256SUMS` file.

   You can also clone the repository and work in its `app/` folder.

2. Create `.env` from the example:

   ```sh
   cp .env.example .env
   ```

3. Set at least `ADMIN_PASSWORD`, `SESSION_SECRET`, `CLICKHOUSE_PASSWORD` and `PUBLIC_URL`. Generate secrets with:

   ```sh
   openssl rand -base64 18   # ADMIN_PASSWORD (at least 12 characters)
   openssl rand -hex 32   # SESSION_SECRET
   openssl rand -hex 16   # CLICKHOUSE_PASSWORD
   ```

4. Start the stack:

   ```sh
   docker compose up -d
   ```

   This pulls the image version set by `PRESSTRACE_VERSION` in `.env` (`0.1.0` in the example file, `latest` when unset). To build the image from source instead, run `docker compose up -d --build` from the `app/` folder of a clone.

5. Check that both containers are healthy:

   ```sh
   docker compose ps
   docker compose logs app
   ```

   The app log shows a line with `"msg":"Listening on http://0.0.0.0:8080"` when it is ready. That address is inside the container; on the host the app is at `http://127.0.0.1:8080`.

The app container has its own health check on `/healthz`, which also pings ClickHouse (see [health check](/app/operations#health-check)). Both containers restart automatically when their process exits (`restart: unless-stopped`).

If a required value is missing, the app exits at start and prints what to fix, for example:

```text
PressTrace cannot start:
- SESSION_SECRET is not set. Generate one with: openssl rand -hex 32
```

Compose itself refuses to start without `CLICKHOUSE_PASSWORD` and prints `Set CLICKHOUSE_PASSWORD in .env`.

## After the install

- Sign in at `PUBLIC_URL` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- [Add a site](/dashboard/setup) and [install the plugin](/plugin/) on it.
- Set up [HTTPS](/app/https), [backups](/app/operations#backups) and [retention](/app/operations#retention).
