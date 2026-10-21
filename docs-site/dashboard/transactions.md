# Transactions

A transaction is one request to the site: a page view, an admin screen, a REST call, an AJAX action or a cron run. The **Transactions** page shows how fast they are and which ones cost the most.

![The Transactions page: summary cards for requests, average, p50, p95, error rate and average queries; a stacked bar chart of PHP, MySQL and external time; and the table of slowest transactions](/screenshots/transactions.png){.shot}

## Summary cards

| Card | Meaning |
|---|---|
| Requests | Requests in the range and the rate per minute, scaled by the sample rate. |
| Avg | Average duration. |
| p50 | Median duration: half the requests are faster. |
| p95 | 95% of requests are faster than this. The p99 is shown below it. |
| Error rate | Share of requests with HTTP 500 or higher, or a PHP error, fatal or uncaught exception. |
| Avg queries | Average number of database queries per request. |

The **Type** menu limits the page to one transaction type: `frontend`, `admin`, `rest`, `ajax`, `cron` or `cli`.

## Overall transaction time

Each bar is the average request in that slice of time, split into PHP (blue), MySQL (orange) and external calls (green). PHP time is the duration minus MySQL and external time, so it includes everything else: template rendering, plugin code, and file and cache access.

A green part that grows means a remote API is getting slower. A tall orange part points to the [Database](/dashboard/database) page. **Show chart data as a table** lists the same numbers as text.

## Slowest transactions

The table is sorted by total time: how much server time the transaction used in the range. A page that takes 300 ms but gets 10 requests a minute can cost more than a 3-second admin screen opened twice a day.

| Column | Meaning |
|---|---|
| Transaction | Name and type. |
| Total % | Share of all request time in the range. |
| Total | Sum of durations, scaled by the sample rate. |
| Max, Avg, p50, p95 | Duration statistics. |
| Rate per min | Requests per minute. |

## Transaction names

| Type | Examples |
|---|---|
| `frontend` | `front-page`, `home`, `page`, `single-post`, `single-product`, `archive-product`, `taxonomy-category`, `search`, `404`, `feed`, `robots.txt` |
| `admin` | `wp-admin/index.php`, `wp-admin/edit.php`, `wp-admin/admin.php?page=wc-settings` |
| `rest` | `REST GET /wp/v2/posts`, `REST GET /wp/v2/posts/{id}`, `REST POST /wp/v2/posts`, and `REST GET unmatched` for routes that do not exist |
| `ajax` | `admin-ajax heartbeat`, `wc-ajax get_refreshed_fragments` |
| `cron` | `wp-cron` |
| other | `wp-login.php`, `xmlrpc.php` |

Developers can rename transactions with the [`presstrace_transaction_name`](/plugin/developers#presstrace-transaction-name) filter.

## Open samples

Click a transaction name to see sample requests. See [samples and traces](/dashboard/traces).
