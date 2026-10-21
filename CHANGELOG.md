# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-21

First public release.

The app, the dashboard and the docs are source-available under the PolyForm Strict License 1.0.0. The WordPress plugin is under GPL-2.0-or-later.

### Added

- WordPress plugin for PHP 7.4+ and WordPress 6.0+. It records transactions, database queries, external HTTP calls, plugin and theme load times, slow hook callbacks and PHP errors, and sends one report per traced request after the response.
- Monitoring window, sample rate, `?presstrace_force=1` for tracing one request, and `wp-config.php` constants for hosting fleets.
- Plugin updates from GitHub releases through the `Update URI` header. Set `PRESSTRACE_DISABLE_UPDATE_CHECK` to turn the check off.
- Translation template (`languages/presstrace.pot`) and multisite-aware uninstall.
- Self-hosted app with Docker Compose: ingest API, ClickHouse storage, and a dashboard with Sites, Transactions, Samples and traces, WordPress, Database, External, Errors and Issues pages.
- Issue detection for N+1 and duplicate queries, too many queries, slow and `SELECT *` queries, slow and failed external requests, slow transactions, slow plugins, PHP errors and high memory use.
- Write buffer capped by size (`BUFFER_MAX_MB`, 64 MB by default). Rows stay in memory while ClickHouse is down and are written once it is back, and retried writes are deduplicated. A full buffer answers `503` with `Retry-After` when ClickHouse is failing and `429` when it is busy.
- Defaults sized for a 2 GB server (`CLICKHOUSE_MEM_LIMIT=1200m`, `APP_MEM_LIMIT=384m`), one-line JSON logs without report data or SQL, and log rotation for both containers.
- Compose publishes the app port on `127.0.0.1` by default. Set `APP_BIND=0.0.0.0` to publish it on all interfaces.
- Graceful shutdown that waits for open requests and the last flush within a 30 second stop period.
- Sign-out revokes the session, and changing `ADMIN_PASSWORD` signs everyone out. Request body limits, a global cap on failed sign-ins, a per-site ingest rate limit, and HSTS when `PUBLIC_URL` uses HTTPS.
- Documentation site.

[0.1.0]: https://github.com/onwp/presstrace-wordpress-apm/releases/tag/v0.1.0
