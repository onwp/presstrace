=== PressTrace ===
Tags: performance, apm, monitoring, profiler, slow queries
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

APM agent for WordPress, released under the GPL. Finds slow plugins, hooks, database queries, external calls and PHP errors without a PHP extension.

== Description ==

PressTrace is the agent half of a self-hosted application performance monitor. It measures each traced request and sends one compact report to your own PressTrace app after the page has been delivered to the visitor. Nothing is stored in your site database except the plugin settings.

What the agent records per request:

* Transaction name and type (front-end template, wp-admin screen, REST route, admin-ajax and wc-ajax action, cron, login, XML-RPC).
* Total time, time in MySQL, time in external HTTP calls, query and call counts, peak memory and HTTP status.
* Every database query with its duration, rows, error and calling plugin or theme. A stack trace is kept for queries of 1 ms or more.
* External calls made through the WordPress HTTP API.
* Load time of each plugin, must-use plugin and the active theme.
* Hook callbacks of plugins and themes that take 1 ms or more, and the total self time of every plugin and theme.
* PHP warnings, notices, deprecations, errors, uncaught exceptions and fatal errors, with the plugin or theme they come from.

The agent stays dormant, at close to zero cost, unless it is configured, monitoring is switched on and inside its window (2, 4, 12 or 24 hours, or always), and the request is picked by the sample rate.

= How it works =

* On activation PressTrace installs `wp-content/mu-plugins/000-presstrace.php` so it starts before other plugins, and `wp-content/db.php` to time queries, but only when no other `db.php` exists. Both files are removed on deactivation, and only when they are PressTrace files.
* If another `db.php` is installed, PressTrace leaves it alone. With Query Monitor it reads query timings through Query Monitor's `log_query_custom_data` filter. With other drop-ins, query times come from `SAVEQUERIES` when it is on; otherwise queries are only counted.
* Hook callbacks are timed by wrapping them in place, so `remove_action()` and `has_filter()` keep working. Callbacks that take arguments by reference are never wrapped.
* The report is sent from a shutdown function after `fastcgi_finish_request()` (or `litespeed_finish_request()`), with a 2 second timeout, or 0.5 seconds when the response cannot be finished early. Failed sends are dropped, and after a connection failure or timeout the agent stops sending for 60 seconds.

= License =

This plugin is free software under the GPLv2 or later. The PressTrace app that receives its reports is source-available under the PolyForm Strict License 1.0.0: it is free for personal and noncommercial use, and commercial use needs a separate license. The PressTrace name and logo are trademarks of the author and are not covered by the GPL. See https://onwp.github.io/presstrace-wordpress-apm/reference/license for details.

= Configuration constants =

For hosting fleets, these constants in `wp-config.php` override the settings screen:

* `PRESSTRACE_APP_URL`: app URL.
* `PRESSTRACE_SITE_KEY`: site key.
* `PRESSTRACE_SAMPLE_RATE`: sample rate from 0 to 1.
* `PRESSTRACE_ALWAYS_ON`: keeps monitoring on with no window.
* `PRESSTRACE_TRACE_CLI`: also trace WP-CLI commands.
* `PRESSTRACE_DISABLE_UPDATE_CHECK`: stop checking GitHub for new releases.

= Updates =

PressTrace is not in the WordPress.org directory. The plugin header sets `Update URI: https://github.com/onwp/presstrace-wordpress-apm`, so WordPress never replaces it with a WordPress.org plugin of the same name. Instead, PressTrace asks the GitHub releases API for the latest stable release about twice a day and offers it on the Plugins screen like any other update. Define `PRESSTRACE_DISABLE_UPDATE_CHECK` as `true` to turn this off and update by hand from https://github.com/onwp/presstrace-wordpress-apm/releases.

= Filters =

* `presstrace_should_trace` (bool $trace, array $context): skip or allow tracing a request. Runs very early, so only code in wp-config.php or in mu-plugins loaded before PressTrace can use it.
* `presstrace_transaction_name` (string $name, string $type, array $context): rename a transaction.
* `presstrace_payload` (array $payload): change or drop (return a non-array) the report before it is sent.

= Trace one request =

While logged in as an administrator, add `?presstrace_force=1` to any URL to trace that request regardless of the monitoring window and the sample rate.

= Known limits =

* Database calls that bypass `$wpdb` (direct mysqli or PDO) and HTTP calls that bypass the WordPress HTTP API (raw cURL, Guzzle, `file_get_contents()`) are not recorded as spans. Their time still shows in the self time of the plugin that made them.
* Code that inspects `WP_Hook::$callbacks` directly sees a PressTrace wrapper object during traced requests. The original callback is available through its `get_wrapped_callback()` method.

== Installation ==

1. Download `presstrace-<version>.zip` from https://github.com/onwp/presstrace-wordpress-apm/releases, or build it with `bin/build-plugin.sh` in the repository. Upload it in Plugins > Add New > Upload Plugin, or unzip it into `wp-content/plugins/` (the zip holds a `presstrace` folder).
2. Activate the plugin.
3. In your PressTrace app, add the site and copy its app URL and site key. Enter them in Tools > PressTrace and click Test connection. On many sites, set the `PRESSTRACE_APP_URL` and `PRESSTRACE_SITE_KEY` constants in `wp-config.php` instead (see Configuration constants).
4. Turn on monitoring and choose a window.

== Frequently Asked Questions ==

= Does PressTrace slow my site down? =

When monitoring is off the agent only reads its settings. On a traced request it adds a small amount of work per query and per plugin hook callback, and the report is sent after the response has been delivered.

= Where is the data stored? =

In your own PressTrace app. The plugin stores only its settings in the `presstrace_settings` option.

= I already use Query Monitor. Can I use both? =

Yes. PressTrace detects the Query Monitor `db.php` and reads query timings through the `log_query_custom_data` filter instead of installing its own drop-in.

== Screenshots ==

1. The settings page under Tools > PressTrace, with connection status, monitoring window, sample rate and drop-in status.
2. The Transactions page in the PressTrace app.
3. A trace of one request, with the time split into PHP, MySQL and external calls.

== Changelog ==

= 0.1.0 =
* First release.

== Upgrade Notice ==

= 0.1.0 =
First release.
