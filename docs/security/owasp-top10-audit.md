# OWASP Top 10 audit of the PressTrace app

Date: 2026-10-21. Scope: the PressTrace app (Hono API, React dashboard, ClickHouse) in `app/`, its container images, its CI and release workflows, and the docs site dependencies. The WordPress plugin in `plugin/` is out of scope for this report.

## Summary

The app was tested against every category of the OWASP Top 10:2025, with test cases derived from the OWASP ASVS 5.0.0 level 2 and the OWASP Web Security Testing Guide (WSTG) 4.2. 83 test cases were run: 75 pass, 5 passed after a fix made during the audit, 2 are accepted limitations of the single-admin design (no multi-factor sign-in, no inactivity timeout), and 1 is not applicable. No critical or high finding is reachable in the app. Four findings were fixed and retested.

| Category | Test cases | Pass | Fixed in this audit | Accepted | N/A | Findings |
|---|---|---|---|---|---|---|
| A01:2025 Broken Access Control | 15 | 15 | 0 | 0 | 0 | none |
| A02:2025 Security Misconfiguration | 10 | 9 | 1 | 0 | 0 | F-03 |
| A03:2025 Software Supply Chain Failures | 8 | 7 | 1 | 0 | 0 | F-04 |
| A04:2025 Cryptographic Failures | 5 | 4 | 1 | 0 | 0 | F-03 |
| A05:2025 Injection | 7 | 7 | 0 | 0 | 0 | none |
| A06:2025 Insecure Design | 6 | 4 | 1 | 0 | 1 | F-02 |
| A07:2025 Authentication Failures | 12 | 10 | 0 | 2 | 0 | F-02 |
| A08:2025 Software or Data Integrity Failures | 6 | 6 | 0 | 0 | 0 | none |
| A09:2025 Security Logging and Alerting Failures | 7 | 6 | 1 | 0 | 0 | F-01 |
| A10:2025 Mishandling of Exceptional Conditions | 7 | 7 | 0 | 0 | 0 | none |
| Total | 83 | 75 | 5 | 2 | 1 | 4 |

| ID | Finding | CVSS 3.1 | Status |
|---|---|---|---|
| F-01 | Rejected session cookies and refused cross-origin requests were not logged | 0.0 None | Fixed, retested |
| F-02 | Global sign-in failure cap let anyone lock the admin out | 5.3 Medium | Fixed, retested |
| F-03 | Plain-http `PUBLIC_URL` on a public host accepted without a warning | 5.4 Medium | Mitigated, retested |
| F-04 | Runtime image shipped npm, corepack and yarn with vulnerable packages, and an outdated zlib | 7.5 High as scored for the package, not reachable in the app | Fixed, retested |

## Scope

In scope:

- Every HTTP route registered in `app/src/server/app.ts`: `GET /healthz`, `POST /api/v1/ingest`, `GET /api/v1/ping`, `GET /api/v1/debug/delay` (only with `ENABLE_DEBUG_ROUTES`), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/sites`, `POST /api/sites`, `GET|PATCH|DELETE /api/sites/:id`, `POST /api/sites/:id/rotate`, `GET /api/sites/:id/transactions|wordpress|database|external|errors|issues|samples`, `GET /api/sites/:id/issues/:fp`, `GET /api/sites/:id/traces/:tid`, the `/api/*` not-found handler, `/assets/*` and other static files, and the dashboard fallback for every other path.
- Every dashboard page in `app/src/web/main.tsx`: Login, Fleet (`/`), Transactions, WordPress, Database, External, Errors, Issues, Issue detail, Trace, Settings (site setup), and Not found.
- `app/Dockerfile`, `app/docker-compose.yml`, `app/clickhouse/`, `.github/workflows/*.yml`, `.github/dependabot.yml`.
- Dependencies of `app/` and `docs-site/`, and the images `ghcr.io/onwp/presstrace` (built from this tree) and `clickhouse/clickhouse-server:26.8.31.2`.

Out of scope: the WordPress plugin, the reverse proxy and TLS setup of a given deployment, the host operating system, and GitHub account settings.

Threat model in one paragraph: the dashboard has one admin. WordPress sites hold a site key that can only write reports for their own site. Report contents (URLs, SQL, hook names, error messages, stack frames) come from WordPress servers and are treated as untrusted. Attackers considered: anonymous internet clients, a cross-site page open in the admin's browser, a stolen or guessed site key, a network observer, and a compromised dependency.

## Methodology

1. Category names and order were taken from the OWASP Top 10:2025. Test cases were derived from ASVS 5.0.0 level 1 and 2 requirements that apply to this app, and mapped to WSTG 4.2 test IDs. Requirements for features the app does not have (OAuth, WebRTC, file upload, GraphQL, WebSockets, password reset, registration) are marked not applicable.
2. Code review of every route, middleware, query builder and dashboard page, with grep sweeps for dangerous sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `child_process`, outbound `fetch` from the server, SQL string building).
3. Black-box probes against the local stack only (`http://127.0.0.1:8080`): unauthenticated probes, authenticated probes with a throwaway site per run (deleted afterwards), and redirect probes. Site keys and cookies were never printed. Failed sign-ins stayed below the per-address limit.
4. Automated tests: new unit and integration tests for every probe that was not yet covered by the suites, written before the fixes where a fix was needed.
5. Dependency and image scans: `pnpm audit` for `app/` and `docs-site/`, Trivy for both images, actionlint for the workflows. CVE details were looked up in public advisories.
6. Scoring: CVSS 3.1 base scores. Retest of every fix with the full test suites and the live probes.

## Environment and versions

| Item | Version |
|---|---|
| Source | git `57e6556` (2026-10-20) plus the uncommitted hardening changes of this audit |
| Host | macOS (Darwin 25.6.0), Docker 29.1.4, Node.js 24.14.1, pnpm 10.33.0 |
| App image | `node:24.22.0-alpine3.24@sha256:44fce696...` (Alpine 3.24.2, Node.js 24.22.0) |
| ClickHouse | `clickhouse/clickhouse-server:26.8.31.2@sha256:05d2e465...` (Ubuntu 22.04) |
| App dependencies | hono 4.13.13, @hono/node-server 2.1.5, zod 4.6.7, @clickhouse/client 1.24.1, react and react-dom 19.3.1, react-router 8.4.0, TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.5 |
| Docs site | VitePress 1.6.4 |
| Tools | Trivy (aquasec/trivy:latest, vulnerability DB of 2026-10-21 07:13 UTC), actionlint 1.7.12, Playwright 1.64.1 |
| Stack settings | `PUBLIC_URL=http://localhost:8080`, `TRUST_PROXY=false`, `APP_BIND=127.0.0.1`, ingest limit 20 per second with a burst of 100, retention 30 days (transactions) and 7 days (spans) |

## Test cases

Result values: Pass, Fixed (failed, then fixed and retested in this audit), Accepted (known limitation, documented below), N/A. "Probe" means a request against the local stack; file references point to the code after this audit.

### A01:2025 Broken Access Control

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A01-01 | ASVS V8.2.1, V8.3.1; WSTG-ATHZ-02 | Every dashboard route needs a session | Probe of all 18 session routes and methods without a cookie; `app/src/server/app.ts:278`; unit test "requires a valid session for dashboard endpoints" | Pass | All 401 `{"error":"Not signed in"}` |
| A01-02 | ASVS V8.2.1; WSTG-ATHZ-03 | A site key cannot read dashboard data | Probe with a valid site key as `Authorization: Bearer` and as the session cookie on 4 routes | Pass | 401 on all 8 requests |
| A01-03 | ASVS V8.2.2; WSTG-ATHZ-04 | Trace of site A cannot be read through site B's id | Probe: ingest a trace for a probe site, read it through the APM Lab id; integration test "keeps each site's data behind its own id" | Pass | own site 200, other site 404 |
| A01-04 | ASVS V8.2.2; WSTG-ATHZ-04 | Samples, transactions and issues are per site | Probe of samples for the probe trace name through the lab id; same integration test | Pass | probe rows not visible in the lab site; other site shows 0 requests and 0 issues |
| A01-05 | ASVS V8.2.2, V8.3.1 | Every report query filters on the site id from the route, not from user data | Review of `app/src/server/queries.ts:9` and `:377`, all report builders | Pass | `site_id = {site:String}` in every query |
| A01-06 | ASVS V8.2.2, V7.4.2 | A deleted site is gone everywhere | Probe after delete; unit test "makes every dashboard route of a deleted site answer 404" (13 routes) | Pass | all 404 `Site not found`, not listed, ping and ingest 401 |
| A01-07 | ASVS V15.3.3, V8.2.3; WSTG-BUSL-02 | `PATCH /api/sites/:id` mass assignment | Probe with `id`, `keyHash`, `keyHint`, `deleted`, `createdAt`; unit test "ignores fields other than name and URL" | Pass | only name and URL change, key and id unchanged |
| A01-08 | ASVS V8.2.2 | A site key writes and reads only its own site | Review of `app/src/server/app.ts:179` (site from key) and `payloadToRows(site.id, ...)`; probe of `GET /api/v1/ping` | Pass | ping names only the key's site |
| A01-09 | ASVS V3.5.1, V3.5.3; WSTG-SESS-05 | Cross-site request forgery | Probe of cross-origin and origin-less `POST /api/sites`, `POST /api/auth/login`, `POST /api/auth/logout`; `app/src/server/auth.ts:257` | Pass | 403, session still valid after a forged logout |
| A01-10 | ASVS V3.4.2; WSTG-CLNT-07 | CORS | Preflight probe with a foreign origin | Pass | 403, no `Access-Control-Allow-Origin` |
| A01-11 | ASVS V13.4.3; WSTG-ATHZ-01 | Path traversal on static files | 13 encoded traversal probes (`/../package.json`, `%2e%2e`, `..%5c`, `%00`) | Pass | 404 plain text, nothing leaked |
| A01-12 | ASVS V3.7.2; WSTG-CLNT-04 | Open redirect through `/login?next=` | 6 probes (`//evil`, `/\evil`, `https://evil`, tab tricks); `app/src/web/lib/redirect.ts:6`; e2e test "sign-in only follows next= to a path on this origin" | Pass | always lands on this origin |
| A01-13 | ASVS V1.3.6, V15.3.2; WSTG-INPV-19 | Server-side request forgery | Review: the server makes no outbound request except to ClickHouse; the site URL is stored and shown, never fetched | Pass | no `fetch` or HTTP client in `app/src/server` |
| A01-14 | ASVS V8.3.1 | Dashboard pages rely on the server for access control | Review of `app/src/web/lib/api.ts:35` (401 sends to Login) for Fleet, Transactions, WordPress, Database, External, Errors, Issues, Issue detail, Trace, Settings; e2e "sign out ends the session" | Pass | pages hold no data without a 200 from the API |
| A01-15 | ASVS V13.4.2 | Debug route | Unit test "does not register the debug route unless ENABLE_DEBUG_ROUTES is on"; it needs a site key when on | Pass | 404 by default |

### A02:2025 Security Misconfiguration

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A02-01 | ASVS V3.4.3, V3.4.4, V3.4.5, V3.4.6; WSTG-CONF-02, WSTG-CLNT-09 | Page headers on `/`, `/login`, every app route and static files | Probe; `app/src/server/app.ts:140`; unit test "sends Permissions-Policy, COOP and CORP, and a page CSP without unsafe-inline" | Pass | CSP without `unsafe-inline`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, Permissions-Policy, COOP, CORP |
| A02-02 | ASVS V14.2.2; WSTG-ATHN-06 | API responses are not cached and not rendered | Probe; unit test "marks API responses as not cacheable" | Pass | `Cache-Control: no-store`, `default-src 'none'` |
| A02-03 | ASVS V3.4.1; WSTG-CONF-07 | HSTS | Unit test "sets security headers" with an https `PUBLIC_URL` | Pass | `max-age=31536000` on https only |
| A02-04 | ASVS V13.4.4; WSTG-CONF-06 | HTTP methods | Probe of TRACE, OPTIONS and PUT on `/`, `/api/sites`, `/api/v1/ingest` | Pass | 404 or 403, no echo of the request |
| A02-05 | WSTG-INFO-02, WSTG-INFO-08 | Server fingerprinting | Probe of response headers | Pass | no `Server`, no `X-Powered-By` |
| A02-06 | ASVS V13.4.1, V13.4.3; WSTG-CONF-04 | Source, backup and metadata files | Probe of `/.env`, `/.git/config`, `/package.json`, `/Dockerfile`, `/src/server/app.ts`, `/assets/`, source maps | Pass | 404, or the dashboard page shell with no data; no `.map` files in the image |
| A02-07 | ASVS V13.2.2, V15.2.3 | Container hardening | Review of `app/docker-compose.yml:56-66`, `app/Dockerfile`; probe inside the container | Pass | uid 1000, read-only root (`touch` fails), `cap_drop: ALL`, `no-new-privileges`, port on 127.0.0.1, ClickHouse port not published, ClickHouse password required |
| A02-08 | ASVS V13.3.1, V12.2.1 | Unsafe settings are refused or reported at start | Unit tests in `app/test/unit/infra.test.ts`; `app/src/server/config.ts:57`, `app/src/server/index.ts:33` | Fixed (F-03) | weak password and secret refused; http `PUBLIC_URL` on a public host and `TRUST_PROXY` on all interfaces logged as warnings |
| A02-09 | ASVS V13.4.2 | Debug features off by default | Review of `app/src/server/config.ts` (`ENABLE_DEBUG_ROUTES` default off) | Pass | off |
| A02-10 | ASVS V13.4.5 | Monitoring endpoint | Probe of `GET /healthz` | Pass | only `{"ok":true}` |

### A03:2025 Software Supply Chain Failures

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A03-01 | ASVS V15.2.1 | Known vulnerable app dependencies | `pnpm audit` in `app/` | Pass | 0 advisories |
| A03-02 | ASVS V15.2.1 | Known vulnerable docs dependencies | `pnpm audit` in `docs-site/` | Pass | 0 advisories |
| A03-03 | ASVS V15.2.1, V15.2.3 | App image | Trivy scan of `ghcr.io/onwp/presstrace` before and after the fix | Fixed (F-04) | 4 high, 8 medium, 1 low before; 0 after |
| A03-04 | ASVS V15.2.1 | ClickHouse image | Trivy scan | Pass, with accepted OS findings | 0 critical or high; 28 medium and 16 low in Ubuntu 22.04 packages, none with a fix released; see "Dependency and image scans" |
| A03-05 | ASVS V15.1.2 | Base images and updates | Review of `app/Dockerfile:4,17`, `app/docker-compose.yml:12`, `.github/dependabot.yml` | Pass | versions pinned by digest, Dependabot for npm, Docker and Actions |
| A03-06 | ASVS V15.2.1 | CI workflows | Review of `.github/workflows/*.yml`; `actionlint` | Pass | Actions pinned to commit SHAs, least-privilege `permissions`, `persist-credentials: false`; actionlint clean |
| A03-07 | ASVS V15.1.2 | Release artifacts | Review of `.github/workflows/release.yml:38,80` | Pass | `SHA256SUMS` for release files, SLSA provenance and SPDX SBOM attestations on the image |
| A03-08 | ASVS V15.2.1 | Reproducible installs | Review of `app/Dockerfile` (`pnpm install --frozen-lockfile`) and CI | Pass | lockfiles enforced |

### A04:2025 Cryptographic Failures

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A04-01 | ASVS V11.2.3, V11.4.1; WSTG-CRYP-04 | Site keys | Review of `app/src/server/sites.ts:19,23`; probe of the key format | Pass | 160 random bits from `crypto.randomBytes`, only a SHA-256 hash and a short hint stored |
| A04-02 | ASVS V7.2.1, V7.2.2, V11.4.3; WSTG-SESS-01 | Session tokens | Review of `app/src/server/auth.ts:22,34,40`; probes with 4 forged cookies; unit tests "rejects tampered bodies and signatures" | Pass | HMAC-SHA256 with a key derived from `SESSION_SECRET` and a hash of `ADMIN_PASSWORD`, 128-bit random session id, constant-time signature check |
| A04-03 | ASVS V6.2.8 | Credential comparison | Review of `app/src/server/auth.ts:122` | Pass | SHA-256 of both sides and `timingSafeEqual`, password not trimmed |
| A04-04 | ASVS V12.2.1, V3.3.1; WSTG-CRYP-03, WSTG-ATHN-01 | Credentials and keys in transit | Review of `app/src/server/app.ts:128,148`; docs on HTTPS | Fixed (F-03) | `Secure` cookie and HSTS on https; warning at start for plain http on a public host |
| A04-05 | ASVS V13.3.1 | Secrets in the repository | `git check-ignore app/.env`; grep for hard-coded secrets | Pass | `.env` ignored; secrets only come from the environment |

### A05:2025 Injection

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A05-01 | ASVS V1.2.4; WSTG-INPV-05 | SQL injection in ClickHouse queries | Review of `app/src/server/queries.ts`; 5 probes through `type`, `route`, `key`, `fp` and `range` (`' OR 1=1 --`, `UNION SELECT`, `'; DROP TABLE sites; --`, `{site:String}`) | Pass | typed query parameters only; probes return empty results or 404, tables intact |
| A05-02 | ASVS V1.2.1, V3.2.2, V1.3.2; WSTG-INPV-02, WSTG-CLNT-01 | Stored XSS from report data on Transactions, WordPress, Database, External, Errors, Issues, Issue detail, Trace, Fleet and Settings | Grep of `app/src/web` for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `href={...}` with data; CSP review | Pass | 0 sinks; React renders text; `script-src 'self'` blocks injected scripts |
| A05-03 | WSTG-INPV-01, WSTG-CLNT-03 | Reflected XSS and HTML injection through query parameters | Review of API answers (JSON with `nosniff` and `default-src 'none'`) and the dashboard (text rendering) | Pass | no reflection into HTML |
| A05-04 | ASVS V1.2.5, V1.3.2; WSTG-INPV-11, WSTG-INPV-12 | Command and code injection | Grep of `app/src` for `child_process`, `exec`, `spawn`, `eval`, `new Function` | Pass | 0 hits |
| A05-05 | ASVS V16.4.1 | Log injection | Review of `app/src/server/log.ts:19`; unit tests on log lines | Pass | one `JSON.stringify` line per entry; client origin trimmed to 200 characters |
| A05-06 | ASVS V15.3.6 | Prototype pollution through ingest JSON | Probe with `__proto__` and `constructor.prototype`; review of the zod schema in `app/src/server/payload.ts:121` | Pass | 202, unknown keys dropped, no pollution |
| A05-07 | ASVS V2.2.1, V1.2.2 | Site URL input | Probes with `javascript:alert(1)`, `https://u:p@x`, 500-character names; `app/src/server/sites.ts:33` | Pass | 400 with a plain message |

### A06:2025 Insecure Design

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A06-01 | ASVS V2.3.2, V15.2.2; WSTG-BUSL-05 | Per-site ingest rate limit | Probe: 160 parallel reports with one key; unit test "rate limits each site with a token bucket" | Pass | 97 processed, 63 refused with 429 and `Retry-After: 1` |
| A06-02 | ASVS V15.2.2; WSTG-BUSL-07 | Ingest size and shape limits | Probes: 2 MB + 1 byte, 5 MB chunked without `Content-Length`, 20 MB gzip bomb, 5000-deep JSON; unit test "returns 413 for a streamed body over 2 MB" | Pass | 413, 413, 413, 400; app stayed up |
| A06-03 | ASVS V15.2.2 | Dashboard body limits | Probes with a 20 KB sign-in body and a 70 KB site body | Pass | 413 both |
| A06-04 | ASVS V6.3.1, V6.1.1; WSTG-ATHN-03 | Sign-in brute force and lockout abuse | Review of `app/src/server/auth.ts:168`; unit tests in `auth.test.ts` and `app.test.ts` | Fixed (F-02) | 5 failures per address or IPv6 /64, 50 across all clients, known admin addresses exempt from the global cap |
| A06-05 | ASVS V16.5.2 | Backpressure when storage is slow | Unit tests "returns 429 ... when the write buffer is full" and "503 ... when ClickHouse is down" | Pass | bounded buffer, 429 or 503 with `Retry-After` |
| A06-06 | ASVS V6.4.1 to V6.4.3; WSTG-IDNT-02, WSTG-ATHN-09 | Registration and password reset flows | Review | N/A | no such flows: one admin set by environment variables |

### A07:2025 Authentication Failures

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A07-01 | ASVS V6.2.1, V6.2.5, V6.2.9, V6.2.11; WSTG-ATHN-07 | Password policy | Review of `app/src/server/config.ts:63,71,79`; unit tests in `infra.test.ts` | Pass | at least 12 characters, no composition rules, no maximum below the 16 KB body limit, placeholders and weak values refused |
| A07-02 | ASVS V6.3.2; WSTG-ATHN-02 | Default credentials | Review: the app does not start without `ADMIN_PASSWORD` | Pass | no default password |
| A07-03 | WSTG-IDNT-04 | Account enumeration | Review of `app/src/server/app.ts:325` | Pass | one message for a wrong email or password, both compared every time |
| A07-04 | ASVS V7.2.4; WSTG-SESS-03 | Session fixation | Probe of two sign-ins; unit test "issues a fresh session id on every sign-in" | Pass | new random token each time |
| A07-05 | ASVS V3.3.1 to V3.3.4; WSTG-SESS-02 | Cookie attributes | Live probe on http; unit test "uses the __Host- prefix with Secure when PUBLIC_URL is https" | Pass | `HttpOnly; SameSite=Lax; Path=/; Max-Age`, plus `Secure` and `__Host-` on https |
| A07-06 | ASVS V7.4.1; WSTG-SESS-06 | Sign-out | Probe: `/api/auth/me` before and after logout with the same cookie; second session kept; integration test "keeps revoked session ids across a restart" | Pass | 200, then 401; other session 200 |
| A07-07 | ASVS V7.1.1, V7.3.1, V7.3.2; WSTG-SESS-07 | Session lifetime | Review of `app/src/server/auth.ts:10` | Accepted | 7-day absolute lifetime, no inactivity timeout (see "Residual risks") |
| A07-08 | WSTG-SESS-01, WSTG-ATHN-04 | Token tampering and bypass | Probes with forged, truncated and badly encoded cookies; tokens signed with the bare secret or an old password (unit) | Pass | 401 |
| A07-09 | ASVS V6.2.10 | Site key rotation | Probe: ping with old and new key after rotate | Pass | old 401, new 200 at once |
| A07-10 | ASVS V7.4.3 (partial) | Ending all sessions | Unit test "derives a different key when the admin password changes" | Pass | changing `ADMIN_PASSWORD` or `SESSION_SECRET` ends every session |
| A07-11 | ASVS V6.3.3 | Multi-factor authentication | Review | Accepted | not implemented (see "Residual risks") |
| A07-12 | ASVS V6.2.6, V6.2.7 | Login form | Review of `app/src/web/pages/Login.tsx:52,60` | Pass | `type="password"`, `autocomplete="current-password"`, paste and password managers allowed |

### A08:2025 Software or Data Integrity Failures

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A08-01 | ASVS V2.2.1, V2.2.2; WSTG-BUSL-01 | Report validation before storage | Review of `app/src/server/payload.ts:121`; probe with wrong types | Pass | 400 with field errors, nothing stored |
| A08-02 | ASVS V2.2.3 | Report timestamps | Probes: 2 hours ahead, 400 days old, year 2100, one valid plus one 30 days ahead | Pass | 400, 400, 400, 202 with `accepted: 1, rejected: 1` |
| A08-03 | ASVS V8.2.2 | Report bound to the authenticated site | Review: the site id comes from the key, the payload has no site field | Pass | no cross-site writes |
| A08-04 | ASVS V14.2.1 | Sensitive URL parts | Review of `app/src/server/transform.ts:105` | Pass | query string, fragment and credentials removed before storage |
| A08-05 | ASVS V1.5.2 | Unsafe deserialization | Review: `JSON.parse` and a schema only | Pass | no object revival or `eval` |
| A08-06 | ASVS V15.1.2 | Integrity of what users download | Same as A03-07 | Pass | checksums and signed attestations |

### A09:2025 Security Logging and Alerting Failures

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A09-01 | ASVS V16.3.1 | Authentication events | Unit test "logs sign-in failure, success and sign-out without secrets" | Pass | `login_success`, `login_failure`, `login_locked`, `logout` |
| A09-02 | ASVS V16.3.2 | Failed authorization | Unit tests in "rejected sessions and cross-origin requests"; live probe with a forged cookie and a foreign origin | Fixed (F-01) | `session_rejected` (`invalid` or `revoked`), `cross_origin_refused`, `bad_site_key` |
| A09-03 | ASVS V16.3.3 | Admin changes | Unit test "logs site create, update, rotate and delete" | Pass | site events with the site id |
| A09-04 | ASVS V16.2.5 | No secrets in logs | Same unit tests check for passwords, tokens, site keys and the secret | Pass | none logged |
| A09-05 | ASVS V16.2.1, V16.2.4 | Log format | Review of `app/src/server/log.ts` and `security.ts:22` | Pass | one JSON object per line with time, level, event and client address |
| A09-06 | ASVS V16.3.3 | Log flooding | Unit tests for `FailureTracker` | Pass | repeated failures logged once per address and minute, with the previous count |
| A09-07 | ASVS V16.4.2, V16.4.3 | Log storage and alerting | Review of `app/docker-compose.yml` logging options | Pass | rotated Docker json-file logs; shipping and alerting are left to the operator and documented on the docs security page |

### A10:2025 Mishandling of Exceptional Conditions

| ID | Reference | What | How | Result | Evidence |
|---|---|---|---|---|---|
| A10-01 | ASVS V16.5.1; WSTG-ERRH-01, WSTG-ERRH-02 | Unexpected errors | Unit test "answers every API error as JSON with an error message and no internals" (a report that throws a ClickHouse error with SQL and a path) | Pass | 500 `{"error":"Internal server error"}`, details only in the log, reduced to a code |
| A10-02 | ASVS V16.5.1; WSTG-ERRH-01 | Error body consistency | Probe of 401, 403, 404, 400, 413 and 429 answers; same unit test | Pass | all `application/json` with one `error` field, no stack or path |
| A10-03 | ASVS V16.5.3 | Malformed input | Probes: invalid JSON, invalid gzip, `Content-Encoding: br`, bad percent-encoding, `page=-1e309` | Pass | 400 or 404 with a plain message, or a clamped value |
| A10-04 | ASVS V16.5.2 | Storage outage | Unit tests for buffer full and ClickHouse down; health check | Pass | 503 or 429 with `Retry-After`; `/healthz` 503 |
| A10-05 | ASVS V16.5.3 | Process-level failures | Unit test "logs unhandled rejections and keeps running, and exits on uncaught exceptions"; `app/src/server/process.ts:12` | Pass | rejection logged, exception logged and process restarted by Docker |
| A10-06 | ASVS V16.5.3 | Fail closed | Review of `app/src/server/app.ts:278-310` and `auth.ts:257` | Pass | any verification error means 401; a request without origin evidence is refused |
| A10-07 | ASVS V15.2.2 | Early answers to oversized bodies | Probe: 413 sent before the body is read, connection then closed | Pass | server keeps serving; clients see the 413 or a closed connection |

## Findings

### F-01 Rejected session cookies and refused cross-origin requests were not logged

- Category: A09:2025. ASVS V16.3.2, V16.3.3.
- CVSS 3.1: 0.0 None, `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N`. It has no direct impact; it hides attacks from the operator.
- Location: `app/src/server/app.ts:278-310` (session and origin middleware).
- Reproduction: send `GET /api/sites` with `Cookie: pt_session=forged.token`, or `POST /api/sites` with `Origin: https://evil.example`. Both were refused (401, 403) with no log line, while sign-in failures and bad site keys were logged.
- Impact: token tampering, use of a stolen and signed-out cookie, and CSRF attempts left no trace.
- Remediation: the middleware now writes `session_rejected` (reason `invalid` or `revoked`) when a cookie was sent but failed the check, and `cross_origin_refused` with method, path and a trimmed origin. A request without a cookie is the normal signed-out state and is not logged. Repeats are coalesced per client address and minute by `FailureTracker` (`app/src/server/security.ts:34`).
- Retest: 3 new unit tests in `app/test/unit/security.test.ts`; live probe produced one `session_rejected` and one `cross_origin_refused` line. Status: fixed.

### F-02 Global sign-in failure cap let anyone lock the admin out

- Category: A06:2025 and A07:2025. ASVS V6.3.1, V6.1.1; WSTG-ATHN-03.
- CVSS 3.1: 5.3 Medium, `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`.
- Location: `app/src/server/auth.ts:168` (`LoginRateLimiter`).
- Reproduction: send 5 wrong sign-ins from each of 10 addresses (or 10 IPv6 /64 networks). For 15 minutes every sign-in, including the admin's with the right password, got 429. Repeating this every 15 minutes kept the admin out.
- Impact: denial of sign-in for the only account. Existing sessions kept working.
- Remediation: addresses (keyed like the per-address limit, IPv6 by /64) that signed in successfully in the last 30 days are exempt from the global cap. The per-address limit of 5 still applies to them. At most 100 such addresses are kept, oldest dropped first, in memory only. The global cap still stops parallel guessing from new addresses.
- Retest: 2 new unit tests in `app/test/unit/auth.test.ts`, the extended app test "caps failed logins across all clients" (known address gets 200 while a new address gets 429). Status: fixed. Residual: an admin signing in from a new address during an attack waits up to 15 minutes.

### F-03 Plain-http PUBLIC_URL on a public host accepted without a warning

- Category: A02:2025 and A04:2025. ASVS V12.2.1, V3.3.1; WSTG-CRYP-03, WSTG-ATHN-01.
- CVSS 3.1: 5.4 Medium, `CVSS:3.1/AV:A/AC:H/PR:N/UI:R/S:U/C:H/I:L/A:N` for a deployment set up this way.
- Location: `app/src/server/index.ts:33`, `app/src/server/config.ts:57`.
- Reproduction: start the app with `PUBLIC_URL=http://203.0.113.10:8080` (the quick start shows this form). The app started silently; the session cookie had no `Secure` flag, no HSTS was sent, and the password and site keys crossed the network in clear text.
- Impact: an observer on the network path can read the admin password, the session cookie and site keys, and then read all monitoring data or delete sites.
- Remediation: the app cannot force TLS, which a reverse proxy terminates, and plain http on a private network is a supported setup. It now logs a warning at start when `PUBLIC_URL` is `http://` on a host other than `localhost`, `*.localhost`, `127.0.0.0/8` or `[::1]`. `.env.example`, the configuration, troubleshooting and security docs say the same.
- Retest: unit test "flags a plain-http PUBLIC_URL unless it points at this machine" in `app/test/unit/infra.test.ts`. Status: mitigated; the operator still decides.

### F-04 Runtime image shipped package managers with vulnerable packages, and an outdated zlib

- Category: A03:2025. ASVS V15.2.1, V15.2.3.
- CVSS 3.1: the worst package advisory is 7.5 High (`CVE-2026-19534`, undici in npm, `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`). In PressTrace none of it was reachable: the app never runs npm, npx, corepack or yarn, makes no WebSocket connections, and Node.js uses its own bundled zlib.
- Location: `app/Dockerfile` runtime stage.
- Reproduction: `trivy image ghcr.io/onwp/presstrace:latest` reported CVE-2026-102276, CVE-2026-102278 and CVE-2026-102277 (brace-expansion 5.0.9), CVE-2026-93748 (http-cache-semantics 4.2.0), CVE-2026-101910 to CVE-2026-101913 (ip-address 10.5.0), CVE-2026-104844 (postcss-selector-parser 7.1.4), CVE-2026-19534, CVE-2026-85024 and CVE-2026-18540 (undici 6.28.0), all under `/usr/local/lib/node_modules/npm`, and CVE-2026-85091 (Alpine zlib 1.3.2-r0, fixed in 1.3.2-r1).
- Impact: none in normal operation; the packages add attack surface after a container compromise and fail image scans that users run.
- Remediation: the runtime stage now runs `apk upgrade --no-cache` and removes npm, npx, corepack and yarn (`app/Dockerfile:22`).
- Retest: Trivy on the rebuilt image reports 0 vulnerabilities; the full e2e suite passes on it. Status: fixed.

## Dependency and image scans

| Target | Tool | Critical | High | Medium | Low | Notes |
|---|---|---|---|---|---|---|
| `app/` dependencies | `pnpm audit` | 0 | 0 | 0 | 0 | |
| `docs-site/` dependencies | `pnpm audit` | 0 | 0 | 0 | 0 | |
| `ghcr.io/onwp/presstrace` before | Trivy | 0 | 4 | 8 | 1 | F-04 |
| `ghcr.io/onwp/presstrace` after | Trivy | 0 | 0 | 0 | 0 | |
| `clickhouse/clickhouse-server:26.8.31.2` | Trivy | 0 | 0 | 28 | 16 | Ubuntu 22.04 packages, no fixed version released |
| `.github/workflows` | actionlint 1.7.12 | | | | | no issues |

The ClickHouse findings are in OS packages of the official image: busybox (CVE-2023-42366, CVE-2024-58251, CVE-2025-46394, CVE-2025-60876), dash (CVE-2026-102473, CVE-2026-102474), glibc (CVE-2026-18374, CVE-2026-89092), gnutls (5 CVEs), pcre2 (7 CVEs), tar (CVE-2026-18477, CVE-2026-18508), wget (CVE-2021-31879) and zlib (CVE-2026-85091). Decision: accepted until the ClickHouse image is rebuilt with fixes (Dependabot proposes new digests). Reasons: ClickHouse is not published on any host port and only the app talks to it, with a password; the server does not run these tools on input from users; wget is used only by the health check against 127.0.0.1. Ubuntu marks the zlib fix as deferred.

## Residual risks and accepted limitations

- No multi-factor sign-in (ASVS V6.3.3, level 2). One admin, a password of at least 12 characters, per-address and global sign-in limits. Mitigation for exposed deployments: put the dashboard behind a VPN or an identity-aware proxy. A TOTP second factor is a candidate for a later release.
- No inactivity timeout (ASVS V7.3.1). Sessions last 7 days from sign-in (absolute limit, V7.3.2 met) and end on sign-out or on a change of `ADMIN_PASSWORD` or `SESSION_SECRET`; a restart keeps them. This matches NIST SP 800-63B AAL1 for a single-admin monitoring tool and is documented on the dashboard and security pages.
- No "sign out other sessions" button (ASVS V7.4.3, V7.4.5). Changing `ADMIN_PASSWORD` or `SESSION_SECRET` ends every session.
- The admin password is a value in `.env`, compared in constant time; it is not stored hashed (ASVS V11.4.2 applies to stored user passwords). Protect `.env` like any server secret.
- No check against breached-password lists (ASVS V6.2.4, V6.2.12); placeholders and well-known weak values are refused at start.
- TLS is the operator's job (reverse proxy). The app warns about plain http on a public host (F-03) but cannot enforce TLS.
- Rate-limit and failure counters live in memory and reset on restart.
- Deleting a site hides it and rejects its key at once; its stored rows remain until normal retention removes them (documented in the operations and setup pages).
- Report data comes from WordPress servers holding a valid key. A compromised site can send misleading data for its own site only.
- ClickHouse image OS findings, as above.

## Retest and verification

All results below are from 2026-10-21 on the working tree that contains the fixes.

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` in `app/` | pass |
| Unit tests | `pnpm test` in `app/` | 185 of 185 pass (175 before this audit, 10 new) |
| Integration tests | `docker compose -f docker-compose.test.yml up -d --wait && pnpm test:integration` | 21 of 21 pass (1 new) |
| End-to-end tests | `docker compose up -d --build`, then `pnpm test:e2e` | 23 of 23 pass |
| Docs build | `pnpm build` in `docs-site/` | pass |
| Workflows | `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` | no issues |
| Live probes | unauthenticated, authenticated and redirect probes against `http://127.0.0.1:8080` | all expected results above; throwaway sites deleted, the existing lab site untouched |
| Image scan | Trivy on the rebuilt app image | 0 vulnerabilities |

New and extended tests:

- `app/test/unit/app.test.ts`: streamed body over 2 MB without `Content-Length`; no mass assignment on update; every route of a deleted site answers 404 and its key stops working; every API error is JSON without internals (including a 500); known address passes the global cap.
- `app/test/unit/auth.test.ts`: known clients pass the global cap but not their own limit; known clients expire and the list is bounded.
- `app/test/unit/security.test.ts`: forged, expired and revoked cookies are logged once per window without the token; a revoked session id is logged as `revoked`; refused cross-origin requests are logged with a trimmed origin.
- `app/test/unit/infra.test.ts`: plain-http `PUBLIC_URL` detection.
- `app/test/integration/clickhouse.test.ts`: traces, samples, transactions and issues of one site are not reachable through another site id, and a deleted site's data is unreachable.

## Sources

- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- OWASP Application Security Verification Standard 5.0.0: https://owasp.org/www-project-application-security-verification-standard/ and https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release
- OWASP Web Security Testing Guide 4.2: https://owasp.org/www-project-web-security-testing-guide/v42/ and https://github.com/OWASP/wstg/tree/v4.2
- CVSS 3.1 specification: https://www.first.org/cvss/v3.1/specification-document
- NIST SP 800-63B, session management: https://pages.nist.gov/800-63-4/sp800-63b.html
- CVE-2026-85091 (zlib): https://osv.dev/vulnerability/CVE-2026-85091, https://ubuntu.com/security/CVE-2026-85091
- CVE-2026-19534 (undici): https://osv.dev/CVE-2026-19534, https://bugzilla.redhat.com/show_bug.cgi?id=2530858
- Trivy: https://trivy.dev/ ; actionlint: https://github.com/rhysd/actionlint
