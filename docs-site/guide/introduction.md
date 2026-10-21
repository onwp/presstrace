# Introduction

PressTrace is a source-available application performance monitor (APM) for WordPress. It shows why a site is slow and which plugin, hook, query or API call causes it.

It is built for agencies, hosting teams and developers who run WordPress sites. It needs no PHP extension, paid service or root access on the WordPress server. You need a server that can run Docker for the app, and the right to install a plugin on each site.

Personal and noncommercial use is free. Commercial use, such as an agency or a host monitoring client sites or a company monitoring its own, needs a commercial license. See [License](/reference/license).

## The two parts

| Part | What it is | Where it runs |
|---|---|---|
| Agent | The PressTrace WordPress plugin. Pure PHP, PHP 7.4 or newer, WordPress 6.0 or newer. | On every WordPress site you want to monitor. |
| App | A Node.js server with the dashboard and the ingest API, plus a ClickHouse database. Shipped as Docker Compose. | On one server of your own. Many sites can send to the same app. |

The plugin measures a request, builds one JSON report and sends it to the app after the page has been delivered to the visitor. It keeps nothing in the WordPress database except its settings.

## What it records

For each traced request (a transaction):

- The name and type. Front-end requests are named by template (`front-page`, `single-product`, `archive-product`, `search`, `404`), admin screens by file (`wp-admin/edit.php`, `wp-admin/admin.php?page=wc-settings`), and also `REST GET /wp/v2/posts`, `admin-ajax heartbeat`, `wc-ajax get_refreshed_fragments`, `wp-cron`, `wp-login.php` and `xmlrpc.php`.
- Total time, and how much of it went to MySQL, to external HTTP calls and to PHP.
- Query count, external call count, peak memory and HTTP status.
- Every database query with its duration, rows and the plugin or theme that ran it.
- External calls made through the WordPress HTTP API.
- Load time of each plugin, must-use plugin and the theme.
- Hook callbacks of plugins and themes that take 1 ms or more, and the total self time of each plugin and theme.
- PHP warnings, notices, deprecations, errors, uncaught exceptions and fatal errors, with the component they come from.

The app then checks each transaction against a set of rules and raises [issues](/issues/) such as N+1 queries or a slow plugin.

## When it runs

The agent stays dormant until three things are true: it has an app URL and a site key, monitoring is switched on and inside its window (2, 4, 12 or 24 hours, or always), and the request is picked by the sample rate. When it is dormant it only reads its settings.

You can also trace a single request on demand, as an administrator, with [`?presstrace_force=1`](/plugin/settings#trace-one-request).

## What it does not do

Version 0.1.0 has no alerts, no integrations (OTLP, Slack, New Relic), a single admin login, and no network-wide agent for multisite. See [known limitations](/reference/limitations) for what the agent cannot see.

## Next steps

- [How it works](/guide/how-it-works) explains the path of one request.
- [Quick start](/guide/quick-start) gets the app and one site running in about 10 minutes.
