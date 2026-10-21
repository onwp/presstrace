# FAQ

## Does PressTrace slow my site down?

A little, mostly on traced requests. In the lab, on a 60 ms page, an untraced request took about 0 to 3 ms more and a traced one about 9 to 12 ms more. The report is sent after the visitor has the page. See [overhead](/reference/overhead) and use [sampling](/plugin/settings#sample-rate) on busy sites.

## Do I need a PHP extension or root access?

No. The agent is plain PHP. You need to install a plugin and, ideally, let it write `wp-content/mu-plugins/000-presstrace.php` and `wp-content/db.php`.

## Where is the data stored?

In the ClickHouse database of your own app. The plugin stores only its settings in the `presstrace_settings` option. See [data and privacy](/reference/privacy).

## I already use Query Monitor. Can I use both?

Yes. PressTrace finds Query Monitor's `db.php` and reads query times through the `log_query_custom_data` filter instead of installing its own drop-in. See [drop-ins](/plugin/drop-ins#query-monitor).

## Can one app monitor many sites?

Yes. Add each site in the app to get its own key. All sites send to the same app URL.

## Why does the dashboard show more requests than I traced?

Counts and rates are scaled by `1 / sample rate`. With a sample rate of 0.1, each traced request counts as ten. Averages and percentiles use the traced requests as they are.

## Why is monitoring off again?

The monitoring window ended. Windows are 2, 4, 12 or 24 hours, or always. Save the settings to start a new window, pick **Always**, or set `PRESSTRACE_ALWAYS_ON`.

## How do I trace one slow page?

Log in as an administrator and add `?presstrace_force=1` to the URL. That request is traced even when monitoring is off.

## Can I trace WP-CLI or cron?

WP-Cron requests through `wp-cron.php` are traced like other requests, named `wp-cron`. WP-CLI commands are traced only with `define( 'PRESSTRACE_TRACE_CLI', true );`.

## What happens when the app is down?

Reports are dropped and the sites keep working. On the first failed send, which happens after the page is delivered, the agent waits at most 2 seconds. It then skips sending for 60 seconds.

## Does it work on multisite?

Multisite was not a target for version 0.1.0, and there is no network-wide agent. Test it on a staging copy of your network before you rely on it.

## Is there an alert when something breaks?

Not in version 0.1.0. Check the Issues page, or script against the [API](/reference/api).

## What license is PressTrace under?

The app, the dashboard and the docs are under the PolyForm Strict License 1.0.0: free for personal and noncommercial use, with no redistribution and no modified versions. The WordPress plugin is under GPL-2.0-or-later. Commercial use, including use inside a company, needs a separate license. See [License](/reference/license).
