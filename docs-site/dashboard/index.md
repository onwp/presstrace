# Sites and navigation

Sign in at your `PUBLIC_URL` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. A session lasts 7 days. **Sign out** ends it.

## Sites

The **Sites** page lists every site that sends data to this app.

![The Sites page with one site, APM Lab: requests, average, p50 and p95 times, error rate, open issues by severity, when it was last seen, and a trend line of the average time](/screenshots/sites.png){.shot}

| Column | Meaning |
|---|---|
| Requests | Traced requests in the time range, scaled by the sample rate. |
| Avg, p50, p95 | Average, median and 95th percentile of the request duration. |
| Error rate | Share of requests with HTTP status 500 or higher, or with a PHP error, fatal error or uncaught exception. Warnings and notices do not count. |
| Open issues | Issues seen in the range, by severity. |
| Last seen | When the app last received data from the site. |
| Avg time trend | Average duration over the range. |

Click a column header to sort. Click a site name to open it. **Add site** creates a new site and its key (see [site setup](/dashboard/setup)).

## Inside a site

Each site has these sections:

| Section | Shows |
|---|---|
| [Transactions](/dashboard/transactions) | Requests over time and the slowest transactions. |
| [WordPress](/dashboard/wordpress) | Plugins, themes, hook callbacks and load times. |
| [Database](/dashboard/database) | The slowest queries and the components that run them. |
| [External](/dashboard/external) | External HTTP calls by host. |
| [Errors](/dashboard/errors) | PHP errors, grouped. |
| [Issues](/dashboard/issues) | Problems found by the detection rules. |
| [Setup](/dashboard/setup) | Connection snippet, key rotation, removal. |

From most tables you can open samples: real requests that match the row, with a link to each [trace](/dashboard/traces).

## Time range and refresh

The range picker at the top sets the window for every page: last 30 minutes, 1 hour (the default), 2, 4, 12 or 24 hours, or 7 days. The range stays in the URL, so you can share a link to the same view. **Refresh** loads the data again.

Charts are split into 30 to 60 bars. The first bar of a range can be partial, because the range start is not aligned to the bar.

## Theme

The **Theme** menu in the header switches between **System**, **Light** and **Dark**. Your choice is saved in the browser.

![The Transactions page in the dark theme](/screenshots/transactions-dark.png){.shot}

## Phones and tablets

The dashboard works from 360 px wide. On small screens the main menu folds into a button, the site sections become a drop-down, and wide tables scroll inside their card.

<div class="shot-row">

![The Sites page on a 390 pixel wide phone](/screenshots/sites-mobile.png){.shot .shot-mobile}

![The Transactions page on a 390 pixel wide phone](/screenshots/transactions-mobile.png){.shot .shot-mobile}

</div>

## Accessibility

Every page can be used with a keyboard. Dialogs keep focus inside, close with Escape, and return focus to the button that opened them. Charts have a **Show chart data as a table** link. Both themes were checked with axe for WCAG 2.2 A and AA.
