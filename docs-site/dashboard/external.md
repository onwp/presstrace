# External

The **External** page lists HTTP calls that the site made through the WordPress HTTP API (`wp_remote_get()`, `wp_remote_post()` and the functions built on them), grouped by host and method.

![The External page: slowest external requests by host and method, with share of total time, total, max, average, number of calls, rate per minute and errors](/screenshots/external.png){.shot}

PHP waits for each call to finish, so a slow API makes every page that calls it slow. Common sources are license checks, update checks, social feeds, payment gateways and analytics.

| Column | Meaning |
|---|---|
| Host | The remote host, with the port when it is not the default. |
| Method | `GET`, `POST` and so on. |
| Total % | Share of all external time in the range. |
| Total, Max, Avg | Time spent waiting for the host. |
| Calls | Number of calls. |
| Rate per min | Calls per minute. |
| Errors | Calls that failed at the transport level (DNS, timeout, refused) or got a 5xx answer. |

Click a host for sample requests, then open a trace to see which plugin made the call and its stack trace.

URLs are stored without their query string. Calls that bypass the WordPress HTTP API, such as raw cURL, Guzzle or `file_get_contents()`, are not listed, but their time shows up in the self time of the plugin that made them. See [known limitations](/reference/limitations).

Related issues: [slow external request](/issues/#slow-external) and [failed external request](/issues/#failed-external).
