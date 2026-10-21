# Security

## Site keys

- A site key is `pt_` followed by 40 hexadecimal characters (160 random bits).
- The app stores only a SHA-256 hash of the key, plus a short hint (`pt_c682...23fb`) to tell keys apart. A copy of the database does not reveal keys.
- The key is shown once, when you add the site or rotate its key.
- Rotating creates a new key and rejects the old one right away.
- The agent sends the key in an `Authorization: Bearer` header. Use [HTTPS](/app/https) so it is not readable on the network.
- A site key can send reports and run the connection test. It cannot read dashboard data.

## Dashboard login

- One admin account, set by `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The password must be at least 12 characters. The app refuses to start with a placeholder, a well-known weak password, a very repetitive value or the admin email as the password, and with a `SESSION_SECRET` that is short, not random or contains the password. Use a long random password, for example from `openssl rand -base64 18`.
- Email and password are compared in constant time.
- After sign-in the app sets a session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`. When `PUBLIC_URL` starts with `https://` it is named `__Host-pt_session` and is `Secure`; the prefix makes browsers refuse a copy planted by a subdomain or over plain http. Otherwise it is named `pt_session`. It is valid for 7 days from sign-in, with no inactivity timeout. Every sign-in gets a new random session id.
- When `PUBLIC_URL` is plain `http://` on a host other than `localhost` or `127.0.0.1`, the app logs a warning at start: passwords, cookies and site keys would cross the network unencrypted.
- The cookie is signed with HMAC-SHA256. The key is derived from `SESSION_SECRET` and a hash of `ADMIN_PASSWORD`, so changing either one signs everyone out.
- Each cookie carries a random session id. Signing out adds that id to a revocation list, so a copy of the cookie stops working at once. The list is kept in memory and in the ClickHouse table `revoked_sessions`, where each id expires with the cookie it belongs to, so it survives restarts.
- State-changing requests (`POST`, `PATCH`, `DELETE`) must come from the same origin as the app or `PUBLIC_URL`. Cross-site requests get `403`.

## Login rate limit

After 5 failed sign-ins from one client address, further attempts get `429` with `Retry-After` until 15 minutes have passed since the first failure. A successful sign-in clears the counter for that address. IPv6 clients are counted per `/64` network, since one client usually controls a whole `/64`.

There is also a cap across all clients: after 50 failed sign-ins in 15 minutes, from any mix of addresses, sign-ins get `429` until the window ends. This stops someone with many addresses from guessing in parallel. Addresses that signed in successfully in the last 30 days are exempt from this cap (not from their own limit of 5), so such an attack does not lock the admin out from the network they normally use. Signing in from a new address during an attack still has to wait for the window to end. Restarting the app clears all counters, since they live in memory.

Behind a reverse proxy, set `TRUST_PROXY=true` so the limit counts each client separately instead of counting the proxy as one client. The app then takes the rightmost address in `X-Forwarded-For`, which a client cannot fake through a proxy that appends to that header. That only holds while clients cannot reach the app without the proxy. Compose publishes the port on `127.0.0.1` by default (`APP_BIND`), and the app logs a warning at start when `TRUST_PROXY` is on and `APP_BIND` is `0.0.0.0`.

## HTTP headers

Every response has `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and a `Permissions-Policy` that turns off browser features the dashboard never uses (camera, microphone, geolocation, payment and others). When `PUBLIC_URL` starts with `https://`, responses also carry `Strict-Transport-Security: max-age=31536000`.

Dashboard pages get a Content Security Policy that allows only the app's own scripts, styles, images, fonts and connections, with no `unsafe-inline`, no plugins (`object-src 'none'`) and no framing. API responses get `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, so browsers and proxies do not cache them and never render them as a page.

## Security event log

The app writes one JSON line per security event to its standard output (`docker compose logs app`), with `"security":true`, an `event` name and the client address. Passwords, cookies and site keys are never logged.

| Event | Level | When |
|---|---|---|
| `login_success`, `logout` | info | Sign-in and sign-out. |
| `login_failure` | warn | Wrong email or password. |
| `login_locked` | warn | A sign-in refused by the rate limit. |
| `session_rejected` | warn | A request with a session cookie that is forged, expired, signed with an old password or secret (`reason: invalid`) or signed out (`reason: revoked`). |
| `cross_origin_refused` | warn | A state-changing request from another origin, with the method, path and origin. |
| `bad_site_key` | warn | An agent request with a missing or unknown site key. |
| `site_create`, `site_update`, `site_key_rotate`, `site_delete` | info | Site changes, with the site id. |

Repeated `session_rejected`, `cross_origin_refused` and `bad_site_key` events from one address are logged once per minute; the next line carries `previousWindowCount`, the number of failures in the minute before. Forward these lines to your log system and alert on bursts of `warn` events.

## Request limits

- Sign-in requests over 16 KB and other dashboard requests over 64 KB are refused with `413`.
- Each site may send 20 reports per second, with bursts of up to 100 (`INGEST_RATE_PER_SITE` and `INGEST_BURST_PER_SITE`). Reports over the limit get `429` with `Retry-After`.
- `GET /api/v1/debug/delay` exists only when `ENABLE_DEBUG_ROUTES=1`. It is meant for the development lab, so leave it off in production.

## Ingest limits

- Reports over 2 MB, before or after decompression, are refused with `413`.
- Every report is validated against the payload schema before anything is stored. Strings have length limits, and component names must match a fixed pattern.
- URLs lose their query string, fragment and credentials before they are stored.
- Transactions with a timestamp outside the retention window or more than one hour ahead are not stored, so a wrong clock on one site cannot affect the writes of other sites.

## The plugin

- The settings page and the connection test need the `manage_options` capability. The test runs through admin-ajax with a nonce.
- `?presstrace_force=1` traces a request only for users with `manage_options`.
- The plugin never writes APM data to the WordPress database.
- A `db.php` that belongs to another plugin is never overwritten or removed.

## OWASP Top 10 audit

The app was audited against the OWASP Top 10:2025, with test cases taken from the OWASP ASVS 5.0.0 (level 2) and the Web Security Testing Guide. The report lists every test case, the findings with CVSS scores and fixes, the dependency and image scans, and the accepted limitations: [OWASP Top 10 audit](https://github.com/onwp/presstrace/blob/main/docs/security/owasp-top10-audit.md).

## Verify a release

The plugin zip, the app bundle and the image are built on GitHub Actions, and each one has a signed build provenance attestation. Check a download with the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify presstrace-0.1.0.zip -R onwp/presstrace
gh attestation verify presstrace-app-0.1.0.tar.gz -R onwp/presstrace
gh attestation verify oci://ghcr.io/onwp/presstrace:0.1.0 -R onwp/presstrace
```

Each release also has a `SHA256SUMS` file for the zip and the bundle.

## Reporting a problem

Report security issues privately through [GitHub private vulnerability reporting](https://github.com/onwp/presstrace/security/advisories/new), not in a public issue. The [security policy](https://github.com/onwp/presstrace/blob/main/SECURITY.md) says what to include.
