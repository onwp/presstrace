# Database

The **Database** page groups queries by fingerprint. A fingerprint is the shape of a query with its values replaced by `?`, so these two queries count as one row:

```sql
SELECT * FROM wp_posts WHERE ID = 12
SELECT * FROM wp_posts WHERE ID = 7
-- fingerprint:
SELECT * FROM wp_posts WHERE ID = ?
```

The app builds the fingerprint. It replaces string and number literals with `?`, collapses `IN (...)` lists and multi-row `VALUES` to one group, removes comments and backticks, and upper-cases SQL keywords.

![The Database page: the slowest queries table with the query fingerprint, caller, share of total time, total, count, average and maximum](/screenshots/database.png){.shot}

## Slowest queries

| Column | Meaning |
|---|---|
| Query | The fingerprint. Click it for sample requests that ran this query. |
| Caller | The plugin, theme or core code that ran it most. |
| Total % | Share of all query time in the range. |
| Total, Count, Avg, Max | Time and number of runs. |

Things to look for:

- A high count with a tiny average: a query in a loop. Check the [N+1](/issues/#n-plus-one) and [duplicate](/issues/#duplicate-query) issues.
- A high average: a slow query. Run `EXPLAIN` on it and see [slow query](/issues/#slow-query).
- `SELECT option_value FROM wp_options WHERE option_name = ?` with a high count: options that are not autoloaded, read one by one. A persistent object cache removes most of these.

## Queries by component

The same time grouped by the plugin, theme or core code that ran the queries: total share, total time, number of queries and average time per query.

## When times are missing

If counts show but times are zero, PressTrace runs in the count-only fallback because another `db.php` is installed and `SAVEQUERIES` is off. See [drop-ins](/plugin/drop-ins#when-another-db-php-exists).
