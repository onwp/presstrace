# Drop-ins and compatibility

PressTrace installs two files outside its plugin folder. Both are written on activation and removed on deactivation, and only when they are PressTrace files.

## The loader mu-plugin

`wp-content/mu-plugins/000-presstrace.php` makes the agent start before any normal plugin, and before other must-use plugins that sort after it, so PressTrace can measure how long each plugin takes to load.

Without the loader the agent still runs from the plugin, but it starts late and misses some plugin load times.

## The db.php drop-in

`wp-content/db.php` is a WordPress drop-in that replaces the database class. The PressTrace version extends `wpdb` and times each call to `wpdb::query()`. For each query it records:

- the SQL, cut to 2000 characters,
- the duration and the number of rows,
- the error text, if the query failed,
- the plugin or theme that called it, found from a short backtrace,
- a stack trace of up to 15 frames, only for queries of 1 ms or more.

When monitoring is off or a request is not sampled, the drop-in does not record anything.

## When another db.php exists

Only one `db.php` can exist. PressTrace never overwrites a `db.php` it did not write. It then picks a fallback, shown as `db_capture` in each report:

| Mode | When | What you get |
|---|---|---|
| `dropin` | The PressTrace `db.php` is installed. | Every query timed, with SQL, rows, caller and stack. |
| `log_query` | Another `db.php` is installed and `SAVEQUERIES` is true. | Query times from the `log_query_custom_data` filter that WordPress runs when it logs a query. Times with SQL, caller and stack. |
| `query_filter` | Another `db.php` is installed and `SAVEQUERIES` is off. | Queries are counted through the `query` filter, but not timed. |

The settings page and the Plugins screen say which case applies, for example: `another database drop-in (...) is installed, so PressTrace runs in fallback mode. Query times come from SAVEQUERIES through the log_query_custom_data filter.`

To get query times with another drop-in, add this to `wp-config.php`:

```php
define( 'SAVEQUERIES', true );
```

`SAVEQUERIES` makes WordPress keep every query of the request in memory, so it costs some memory on pages with many queries.

## Query Monitor

PressTrace runs alongside Query Monitor. Query Monitor ships its own `db.php`, so PressTrace uses the `log_query` mode. In the release check, a 300 ms `SELECT SLEEP(0.3)` was recorded as 300.9 ms with Query Monitor and as 301.5 ms with the PressTrace drop-in, with the same SQL, stack and component.

When Query Monitor's `db.php` is installed, PressTrace leaves it alone. When you deactivate PressTrace, it removes only its own `db.php` and keeps Query Monitor's.

## Hook callbacks

PressTrace wraps the hook callbacks of plugins and themes in place: the wrapper sits in the same slot of `WP_Hook::$callbacks`, under the same key. So `remove_action()`, `remove_filter()` and `has_filter()` keep working, and callback order does not change. Core callbacks are not wrapped.

There are two exceptions to this:

- Callbacks that take arguments by reference are never wrapped, since a wrapper would break the reference. They are not timed on their own.
- Code that reads `WP_Hook::$callbacks` directly sees a PressTrace wrapper object on traced requests. The original callback is available from the wrapper's `get_wrapped_callback()` method.

Callbacks of 1 ms or more become their own spans. Shorter calls are added up into the self time of their plugin or theme.

## Error handlers

PressTrace installs its PHP error and exception handlers in front of the existing ones and passes every error on. Other plugins that set their own handlers keep working.

## Caching plugins

A full page cache serves pages without loading WordPress, so those requests are never traced. PressTrace shows the requests that reach PHP: cache misses, logged-in users, admin, REST and AJAX.
