# Environment variables

The app reads its settings from `app/.env`. Compose passes the whole file to the app container and uses some values for ClickHouse and for the containers themselves. After a change, recreate the containers:

```sh
docker compose up -d --force-recreate
```

## Variables in `.env`

| Variable | Default | Required | What it does |
|---|---|---|---|
| `ADMIN_EMAIL` | `admin@example.com` | No | Email for the single dashboard login. Compared in lower case. |
| `ADMIN_PASSWORD` | none | Yes | Password for the dashboard login. At least 12 characters. The app refuses to start with a placeholder (such as `change-me` or `a-long-password`), a well-known weak password (such as `password123456`), a value with fewer than 5 different characters, or the admin email or its local part. Generate one with `openssl rand -base64 18`. |
| `SESSION_SECRET` | none | Yes | Key that signs the session cookie, together with a hash of `ADMIN_PASSWORD`. At least 32 characters, with at least 10 different characters, not a placeholder and not containing `ADMIN_PASSWORD`. Generate it with `openssl rand -hex 32`. Changing it, or the admin password, signs everyone out. |
| `PUBLIC_URL` | `http://localhost:8080` | Yes, in practice | The address WordPress sites and browsers use to reach the app, without a trailing slash. It appears in the `wp-config.php` snippet. When it starts with `https://`, the session cookie gets the `Secure` flag and responses carry `Strict-Transport-Security`. It is also an allowed origin for sign-in and other changes. The app logs a warning at start when it is plain `http://` on a host other than `localhost` or `127.0.0.1`, because passwords, cookies and site keys would then cross the network unencrypted. |
| `APP_PORT` | `8080` | No | Host port that Compose publishes for the app. |
| `APP_BIND` | `127.0.0.1` | No | Host address Compose publishes the port on. The default only accepts connections from the server itself, which is what you want behind a reverse proxy on the same server. Set `0.0.0.0` to accept connections on every interface, for example when WordPress servers on other hosts send reports straight to the app. See [HTTPS](/app/https). |
| `TRUST_PROXY` | `false` | No | Set to `true` (or `1`) when the app runs behind a reverse proxy that sets `X-Forwarded-For`. The login rate limit then uses the rightmost address in that header. Leave it `false` when clients reach the app directly, or they could fake their address. The app logs a warning at start when it is `true` and `APP_BIND` is `0.0.0.0`. |
| `TRANSACTIONS_TTL_DAYS` | `30` | No | Days to keep transactions, issue events and errors. Integer from 1 to 3650. |
| `SPANS_TTL_DAYS` | `7` | No | Days to keep spans (queries, external calls, callbacks). Integer from 1 to 3650. |
| `CLICKHOUSE_DATABASE` | `presstrace` | No | Database name. Used by both containers. |
| `CLICKHOUSE_USER` | `presstrace` | No | ClickHouse user. Used by both containers. |
| `CLICKHOUSE_PASSWORD` | none | Yes | ClickHouse password. Used by both containers. |
| `CLICKHOUSE_MEM_LIMIT` | `1200m` | No | Memory limit of the ClickHouse container. The default fits a 2 GB server. See [sizing](/app/#sizing). |
| `APP_MEM_LIMIT` | `384m` | No | Memory limit of the app container. Node.js gets a heap of 75% of it. |
| `BUFFER_MAX_MB` | `64` | No | How much report data, in MB, the app keeps in memory while it waits for ClickHouse. When the buffer is full, new reports get `503` if ClickHouse is failing and `429` if it is only busy. Integer from 1 to 4096. Keep it well under a third of `APP_MEM_LIMIT`. |
| `INGEST_RATE_PER_SITE` | `20` | No | Reports per second that one site may send. Integer from 0 to 100000. `0` turns the limit off. |
| `INGEST_BURST_PER_SITE` | `100` | No | Reports a site may send at once before `INGEST_RATE_PER_SITE` applies. Reports over the limit get `429` with `Retry-After`. |
| `ENABLE_DEBUG_ROUTES` | `false` | No | Set to `1` or `true` to add `GET /api/v1/debug/delay`, which the development lab uses. Leave it off in production. |
| `PRESSTRACE_VERSION` | `latest` in Compose, `0.1.0` in `.env.example` | No | Tag of the `ghcr.io/onwp/presstrace` image that Compose pulls. Pin a version so that `docker compose pull` does not upgrade by surprise. |

Retention changes take effect on the next start of the app. See [retention](/app/operations#retention).

## Variables set by Compose or the image

You only need these when you run the app without the provided `docker-compose.yml`, for example with `node dist/server/index.js`.

| Variable | Default in code | Set to | What it does |
|---|---|---|---|
| `CLICKHOUSE_URL` | `http://localhost:8123` | `http://clickhouse:8123` by Compose | HTTP address of ClickHouse. |
| `PORT` | `8080` | `8080` by Compose and the image | Port the app listens on inside the container. Compose overrides any `PORT` in `.env`; use `APP_PORT` to change the host port. |
| `HOST` | `0.0.0.0` | not set | Address the app binds to inside the container. |
| `NODE_OPTIONS` | not set | `--max-old-space-size-percentage=75` by Compose and the image | Sizes the Node.js heap to 75% of the container memory limit, so the app hits its own heap limit before the kernel kills the container. |
| `WEB_ROOT` | `dist/web` | `/app/dist/web` by the image | Folder with the built dashboard. |

Outside Compose, `CLICKHOUSE_USER` defaults to `default` and `CLICKHOUSE_PASSWORD` to an empty string.

## Example

```sh
ADMIN_EMAIL=ops@example.com
ADMIN_PASSWORD=Xq3v...           # openssl rand -base64 18
SESSION_SECRET=4f3c...           # openssl rand -hex 32
PUBLIC_URL=https://apm.example.com
APP_PORT=8080
APP_BIND=127.0.0.1
TRUST_PROXY=true
TRANSACTIONS_TTL_DAYS=30
SPANS_TTL_DAYS=7
CLICKHOUSE_DATABASE=presstrace
CLICKHOUSE_USER=presstrace
CLICKHOUSE_PASSWORD=9b1d...      # openssl rand -hex 16
CLICKHOUSE_MEM_LIMIT=1200m
APP_MEM_LIMIT=384m
PRESSTRACE_VERSION=0.1.0
```
