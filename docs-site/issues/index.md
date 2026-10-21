# Issues reference

The app runs these rules on each transaction as it arrives. In version 0.1.0 the thresholds are fixed. Each match becomes an issue event with a severity, a "what is happening" text and a suggested fix, and events with the same type, route and subject are grouped into one issue.

![An issue detail page in the dark theme: a high severity slow external request with what is happening and the suggested fix](/screenshots/issue-detail-dark.png){.shot}

| Type | Rule | Severity |
|---|---|---|
| [N+1 query](#n-plus-one) | Same query shape 5+ times in one request, with different values | Medium at 20+ runs or 50+ ms in total, else low. Options lookups: low |
| [Duplicate query](#duplicate-query) | Identical SQL 3+ times in one request | Low |
| [Too many queries](#too-many-queries) | 100+ queries in one request | Low, medium at 300+ |
| [Slow query](#slow-query) | One query 100 ms or more | Medium, high at 1000 ms+ |
| [SELECT * query](#select-star) | `SELECT *` from a plugin, theme or drop-in | Low |
| [Slow external request](#slow-external) | One external call 500 ms or more | Medium, high at 2000 ms+ |
| [Failed external request](#failed-external) | Transport error or HTTP 5xx | Medium |
| [Slow transaction](#slow-transaction) | Request 1000 ms or more | Medium, high at 3000 ms+ |
| [Slow plugin or theme](#slow-plugin) | One component 200 ms or more of self time | Medium, high at 1000 ms+ |
| [PHP error](#php-error) | Fatal, error or uncaught exception; warning | High; warning low |
| [High memory usage](#high-memory) | Peak memory 80%+ of `memory_limit` | Medium |

The rules work on what the agent recorded. If another drop-in replaces the PressTrace `db.php` and `SAVEQUERIES` is off, queries have no times and the time-based query rules cannot fire. Requests with more than 500 spans keep only the slowest 500.

## N+1 query {#n-plus-one}

Type `n_plus_one`, title "Possible N+1 query".

Rule: the same fingerprint ran 5 or more times in one request, with at least two different SQL strings. Identical repeats are reported as a [duplicate query](#duplicate-query) instead.

Severity: medium when it ran 20 or more times, or took 50 ms or more in total. Otherwise low.

What it means: code in a loop, usually over posts, products or users, fetches one row at a time instead of loading all rows at once. The text names the component that ran most of the calls.

How to fix: the suggestion depends on the table.

| Table | Fix |
|---|---|
| `postmeta` | Prime the meta cache before the loop with `update_meta_cache( 'post', $post_ids )` (or `update_postmeta_cache( $post_ids )`). With `WP_Query`, keep `'update_post_meta_cache' => true` (the default) and do not pass `'cache_results' => false`. |
| `posts` | Load the posts in one query with `new WP_Query( array( 'post__in' => $ids, 'posts_per_page' => count( $ids ) ) )`, or prime the cache with `_prime_post_caches( $ids )` or `update_post_caches( $posts )`. |
| `termmeta` | Call `update_termmeta_cache( $term_ids )` before the loop, or use `get_terms( array( 'update_term_meta_cache' => true ) )`. |
| `terms`, `term_taxonomy`, `term_relationships` | Prime with `update_object_term_cache( $post_ids, 'post' )`, or keep `'update_post_term_cache' => true`. Prefer `get_the_terms()`: `wp_get_post_terms()` always bypasses the cache. |
| `users`, `usermeta` | Call `cache_users( $user_ids )` before the loop, or use `WP_User_Query` with `'include' => $user_ids`. |
| `options` | Read options once into a variable, autoload options needed on every request, and create missing ones with `add_option()`. A persistent object cache removes these lookups. |
| `comments`, `commentmeta` | One `get_comments()` call, and `update_meta_cache( 'comment', $comment_ids )`. |
| other | Load all rows in one query (`WHERE id IN (...)`) before the loop. Cache reused results with `wp_cache_get()` and `wp_cache_set()` on a persistent object cache, or with a transient. |

### Options loaded one by one

This is a special case of N+1, where each query looks up a single row in the options table by `option_name`. `get_option()` runs one query for every option that is not autoloaded or does not exist. WooCommerce on a site without a persistent object cache often does this 20 or more times per page.

These events have the title "Options loaded one by one" and are always low. Fix: install a persistent object cache (Redis or Memcached). Store options needed on every request with autoload on (`update_option( $name, $value, true )`). Load a known list of options in one query with `wp_prime_option_caches( $names )` (WordPress 6.4+). Create missing options with `add_option()` so WordPress caches that they are empty.

## Duplicate query {#duplicate-query}

Type `duplicate_query`, severity low.

Rule: the exact same SQL, with the same values, ran 3 or more times in one request. One event per fingerprint per request.

What it means: a result was not reused. A common cause is a `get_option()` call for an option that does not exist, or a direct `$wpdb` query in a function that is called many times.

How to fix: keep the result after the first call, in a variable or a static property for the request, or with `wp_cache_set()` so other code can reuse it. Create a missing option with `add_option()` so WordPress caches the empty value. Direct `$wpdb` calls bypass the object cache, so prefer `get_post_meta()`, `get_option()` and `get_term()` where they exist.

## Too many queries {#too-many-queries}

Type `too_many_queries`.

Rule: 100 or more queries in one request. Severity low, medium at 300 or more.

What it means: each query is a round trip to MySQL, so hundreds of fast queries add up.

How to fix: install a persistent object cache (Redis or Memcached with a drop-in such as Redis Object Cache), so options, post meta, terms and users come from memory. Then use the [Database](/dashboard/database) page to find the components that run the most queries, and look for N+1 patterns. A full page cache avoids the queries for anonymous visitors.

## Slow query {#slow-query}

Type `slow_query`.

Rule: one run of a query took 100 ms or more. One event per fingerprint, measured by its slowest run. Severity medium, high at 1000 ms or more.

What it means: PHP waits for MySQL during that time, and the query holds database resources other requests need.

How to fix:

- The autoloaded options query: check the autoload size with `SELECT SUM(LENGTH(option_value)) FROM wp_options WHERE autoload IN ('yes', 'on')`. Above about 1 MB every page gets slower. Set autoload off for large options that are not needed on every request (`wp_set_option_autoload()` in WordPress 6.4+), and delete leftovers of removed plugins and expired transients.
- A meta query on `meta_value` in `wp_postmeta`: this column has no useful index. Store the value in a taxonomy or a custom table column, or add a targeted index. Cache the result with a transient or `wp_cache_set()`.
- `ORDER BY RAND()`: MySQL reads and sorts the whole table. Pick random IDs in PHP from a cached list, or cache the random pick for a few minutes.
- Anything else: run `EXPLAIN`. Add an index on the columns in `WHERE`, `JOIN` and `ORDER BY`, avoid `LIKE '%...%'` and functions on indexed columns, and limit the rows. Cache results that do not change on every request.

## SELECT * query {#select-star}

Type `select_star`, severity low.

Rule: a query from a plugin, must-use plugin, theme or drop-in selects every column (`SELECT *` or `SELECT table.*`). Core queries are ignored. One event per fingerprint per request.

What it means: wide columns such as `post_content`, `meta_value` or `option_value` are read and sent to PHP even when the code needs a few fields.

How to fix: select only the columns the code uses. With `WP_Query` or `get_posts()`, pass `'fields' => 'ids'` when only IDs are needed. With `WP_User_Query`, pass `'fields' => array( 'ID', 'display_name' )`. In direct `$wpdb` queries, list the columns.

## Slow external request {#slow-external}

Type `slow_external`.

Rule: one external call took 500 ms or more. One event per method and host per request, for the slowest call. Severity medium, high at 2000 ms or more.

What it means: PHP waits for the remote server, so the whole request is at least that slow for the visitor.

How to fix: cache the response with `set_transient()` so the call runs once per interval. Move calls that do not need to finish before the page renders to WP-Cron (`wp_schedule_single_event()`) or Action Scheduler. Pass a short `'timeout'` to `wp_remote_get()` and `wp_remote_post()` (the default is 5 seconds) and handle failures without retrying on every page view. If a plugin runs update or license checks on every admin page, report it to the plugin author.

## Failed external request {#failed-external}

Type `failed_external`, severity medium.

Rule: an external call failed at the transport level (DNS, timeout, connection refused, shown with its cURL error) or got a status of 500 or higher. One event per method and host per request.

What it means: the feature that depends on the call probably did not work for this request.

How to fix: check that the remote service is reachable from the server, and that API keys and licenses are valid. In code, check `is_wp_error()` and `wp_remote_retrieve_response_code()` before using the body. After a failure, store a short-lived transient so the site does not retry on every request. Set a short `'timeout'`.

## Slow transaction {#slow-transaction}

Type `slow_transaction`.

Rule: the request took 1000 ms or more. Severity medium, high at 3000 ms or more.

What it means: the detail text gives the split, for example `The "front-page" request took 1.61 s: 494 ms in PHP, 308 ms in MySQL and 811 ms waiting for external calls.`

How to fix: the suggestion follows the largest part.

- External calls are half or more: see [slow external request](#slow-external).
- MySQL is half or more: open the Database tab, index slow queries, remove N+1 patterns, add a persistent object cache.
- PHP is half or more: open a sample trace and sort by duration to find the slowest callbacks. Use a full page cache for anonymous traffic, make sure OPcache is on and the site runs a supported PHP 8 version, and remove plugins not needed on this route.
- No single part dominates: open a sample trace and check the breakdown. A full page cache and a persistent object cache help most sites.

## Slow plugin or theme {#slow-plugin}

Type `slow_plugin`, title "Slow plugin" or "Slow theme".

Rule: one plugin, must-use plugin, theme or drop-in used 200 ms or more of self time in one request. Severity medium, high at 1000 ms or more.

What it means: self time includes the queries and external calls its callbacks made, and excludes time in other plugins it calls through hooks. The text gives the number of callback calls.

How to fix, for a plugin: open the [WordPress](/dashboard/wordpress) tab for its slowest hooks and callbacks, and a sample trace to see what they do. Turn off features you do not use, load the plugin only on pages that need it, update it, or replace it with a lighter one. Report the slow callback to the author with the trace details.

For a theme: check which theme callbacks are slow. Page builders and theme frameworks often do heavy work on every request. Turn off unused theme features, cache generated CSS and menus, or switch to a lighter theme.

## PHP error {#php-error}

Type `php_error`.

Rule and severity:

| Level | Title | Severity |
|---|---|---|
| `fatal` | PHP fatal error | High |
| `error` | PHP error | High |
| `exception` (uncaught) | Uncaught exception | High |
| `warning` | PHP warning | Low |
| `notice`, `deprecated` | not raised | |

The same level, message, file and line count once per request. Numbers in the message are ignored for grouping.

What it means: a fatal error or uncaught exception stopped the request, and visitors see an error page or a broken response. A warning does not stop the request, but usually points to a bug such as an undefined array key or a missing file.

How to fix a fatal or exception: check whether the component was updated recently or needs a newer PHP version ("Requires PHP" in its readme). Roll back or update it, and reproduce the error on a staging copy with `WP_DEBUG` and `WP_DEBUG_LOG` on. WordPress recovery mode can pause the component from the link in the admin email while you fix it.

How to fix a warning: update the component and report the warning to its author if it stays. Keep `WP_DEBUG_DISPLAY` off on production so visitors do not see warnings. Use `WP_DEBUG_LOG` on a staging copy to reproduce it.

## High memory usage {#high-memory}

Type `high_memory`, severity medium.

Rule: peak memory reached 80% or more of the PHP `memory_limit`. Not checked when `memory_limit` is `-1` (unlimited).

What it means: requests close to the limit can fail with `Allowed memory size exhausted` fatal errors.

How to fix: find code that loads large data sets, such as `WP_Query` with `'posts_per_page' => -1`, loading every user, order or product, or very large option arrays. Paginate, use `'fields' => 'ids'`, and process large jobs in batches through WP-Cron or Action Scheduler. Raise `WP_MEMORY_LIMIT` in `wp-config.php` only after you confirm the usage is expected.
