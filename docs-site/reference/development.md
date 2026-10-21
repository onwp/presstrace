# Development

## Repository layout

| Path | What it is |
|---|---|
| `plugin/presstrace/` | The WordPress agent. PHP 7.4+, PHPUnit tests in `tests/`. |
| `app/` | The app: Hono server in `src/server`, React dashboard in `src/web`, shared types in `src/shared`, tests in `test/`. |
| `dev/lab-scenarios/` | The PressTrace Lab Scenarios plugin, which makes requests slow or broken on purpose. |
| `bin/build-plugin.sh` | Builds `dist/presstrace-<version>.zip`. |
| `docs/` | The architecture overview (`docs/architecture.md`) and the security audit report (`docs/security/`). |
| `docs-site/` | This documentation site. |

## The ddev lab

The lab is a WordPress site in [ddev](https://ddev.com) (nginx-fpm, PHP 8.3, MariaDB 10.11) with WooCommerce and Query Monitor. A `.ddev/docker-compose.presstrace.yaml` file mounts the plugin and the lab plugin from this repository into the site, so edits apply at once:

```yaml
services:
  web:
    volumes:
      - /path/to/presstrace/plugin/presstrace:/var/www/html/web/wp-content/plugins/presstrace
      - /path/to/presstrace/dev/lab-scenarios:/var/www/html/web/wp-content/plugins/presstrace-lab-scenarios
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Adjust the paths to where your copy lives. The `extra_hosts` line lets WordPress reach the app on the host as `http://host.docker.internal:8080`. Use that as the app URL in the lab.

Start the app with Docker Compose as in [install the app](/app/), with `ENABLE_DEBUG_ROUTES=1` in `app/.env` so the `slow_external` scenario has its slow endpoint. Add a site named for example `APM Lab`, and connect the lab site with the key. Docker Desktop forwards `host.docker.internal` to ports published on `127.0.0.1`, so the default `APP_BIND` works for the lab. On Linux, `host.docker.internal` is the Docker bridge address, so set `APP_BIND` to that address (often `172.17.0.1`) or to `0.0.0.0`.

## Lab scenarios

The lab plugin only runs when `WP_DEBUG` or `PRESSTRACE_LAB` is true. Never install it on a real site. A query parameter turns a scenario on for one request, and commas combine several, for example `?pt_scenario=slow_hook,n_plus_one`.

| Scenario | What it does | Issue it raises |
|---|---|---|
| `slow_hook` | A callback that blocks for 300 ms. `&pt_ms=N` (1 to 10000) changes it. | Slow plugin, slow transaction with a high value |
| `n_plus_one` | The same query shape 30 times, with the meta cache cleared each time. | N+1 query |
| `slow_query` | `SELECT SLEEP(0.3)`. | Slow query |
| `slow_external` | An 800 ms call to the app's `/api/v1/debug/delay`, with the site key. Without `ENABLE_DEBUG_ROUTES=1` the app answers `404`, and the scenario calls `https://httpbin.org/delay/1` instead. | Slow external request |
| `failed_external` | A call to port 9, where nothing listens. | Failed external request |
| `php_warning` | A warning, a notice and a deprecation. | PHP warning (low) |
| `fatal` | A call to an undefined function. | PHP fatal error |
| `exception` | An uncaught exception. | Uncaught exception |
| `many_queries` | 150 small queries. `&pt_queries=N` (1 to 2000) changes it. | Too many queries |
| `select_star` | `SELECT * FROM wp_posts LIMIT 20`. | SELECT * query |
| `memory` | Raises peak memory to about 85% of a 256 MB limit. | High memory usage |

Example traffic from inside the ddev web container:

```sh
for p in / '/?pt_scenario=slow_hook' '/?pt_scenario=n_plus_one' '/?pt_scenario=slow_external'; do
  ddev exec "curl -sk -o /dev/null -w '%{http_code} %{time_total} $p\n' 'http://localhost$p'"
done
```

## Plugin tests

```sh
cd plugin/presstrace
composer install
composer test
```

`composer test` runs PHPUnit. The tests do not need WordPress or a database.

## App tests

```sh
cd app
pnpm install
pnpm test               # unit tests
pnpm typecheck
```

Integration tests need a throwaway ClickHouse on port 18123:

```sh
docker compose -f docker-compose.test.yml up -d --wait
pnpm test:integration
```

`CLICKHOUSE_TEST_URL`, `CLICKHOUSE_TEST_USER` and `CLICKHOUSE_TEST_PASSWORD` override the defaults (`http://localhost:18123`, `test`, `test`). Each run uses a new database.

End-to-end tests drive a browser with Playwright against a running app, including an axe accessibility check on every page:

```sh
E2E_BASE_URL=http://localhost:8080 E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... pnpm test:e2e
```

Set `E2E_SCREENSHOT_DIR` to keep the screenshots it takes.

## Running the app without Docker

With ClickHouse running somewhere:

```sh
cd app
pnpm install
ADMIN_PASSWORD=... SESSION_SECRET=... CLICKHOUSE_URL=http://localhost:8123 \
  CLICKHOUSE_USER=... CLICKHOUSE_PASSWORD=... pnpm dev
pnpm dev:web            # in a second terminal: Vite on port 5173, proxies /api to port 8080
```

`pnpm build` builds the dashboard and bundles the server into `dist/`. `pnpm start` runs the bundle.

## This documentation

```sh
cd docs-site
pnpm install
pnpm dev                # local preview with hot reload
pnpm build              # static site in .vitepress/dist
pnpm preview            # serve the built site
pnpm screenshots        # retake the screenshots from a running app and lab
```

`pnpm screenshots` uses Playwright from `app/node_modules`, so run `pnpm install` in `app/` first. It signs in to the app, reads the site `APM Lab` and writes PNGs to `public/screenshots/`, masking site keys before each capture. Its settings come from environment variables: `PT_APP_URL`, `PT_EMAIL`, `PT_PASSWORD`, `PT_SITE_NAME`, `PT_RANGE`, `PT_WP_URL`, `PT_WP_USER` and `PT_WP_PASSWORD`. When `python3` with Pillow is available, the PNGs are reduced to 256 colors afterwards.
