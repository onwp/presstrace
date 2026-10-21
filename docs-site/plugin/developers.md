# Filters for developers

PressTrace has three filters. Use them to skip requests, rename transactions, or change the report before it leaves the site.

## presstrace_should_trace

```php
apply_filters( 'presstrace_should_trace', bool $trace, array $context )
```

Decides whether the current request is traced. It runs after the built-in checks (configured, monitoring on, sampled), so it can only turn tracing off for a request that would be traced, or confirm it.

`$context` has three keys:

| Key | Type | Meaning |
|---|---|---|
| `forced` | bool | The request has `?presstrace_force=1`. |
| `cli` | bool | The request is a WP-CLI command. |
| `uri` | string | `$_SERVER['REQUEST_URI']`. |

The filter runs from the loader mu-plugin, very early. Only code in `wp-config.php`, or in a must-use plugin that loads before `000-presstrace.php`, can hook into it. Normal plugins and themes load too late.

Example: a must-use plugin `wp-content/mu-plugins/00-presstrace-rules.php` that never traces health checks:

```php
<?php
add_filter( 'presstrace_should_trace', function ( $trace, $context ) {
	if ( 0 === strpos( $context['uri'], '/healthcheck' ) ) {
		return false;
	}
	return $trace;
}, 10, 2 );
```

Must-use plugins load in alphabetical order, so `00-...` loads before `000-presstrace.php`.

## presstrace_transaction_name

```php
apply_filters( 'presstrace_transaction_name', string $name, string $type, array $context )
```

Renames a transaction before it is sent. `$type` is one of `frontend`, `admin`, `rest`, `ajax`, `cron`, `cli`. Use it when the default name groups requests that you want apart, or splits ones you want together.

```php
add_filter( 'presstrace_transaction_name', function ( $name, $type ) {
	if ( 'page' === $name && is_page( 'checkout' ) ) {
		return 'page-checkout';
	}
	return $name;
}, 10, 2 );
```

Keep names stable and low in number. Never put IDs or user data in a name, or every request gets its own row on the Transactions page.

## presstrace_payload

```php
apply_filters( 'presstrace_payload', array $payload )
```

Runs at shutdown with the complete report ([payload format v1](/reference/payload)). Return a changed array, or return anything that is not an array to drop the report.

Example: remove the SQL text of queries on a custom table that holds personal data:

```php
add_filter( 'presstrace_payload', function ( $payload ) {
	foreach ( $payload['transactions'] as &$tx ) {
		foreach ( $tx['spans'] as &$span ) {
			if ( 'db' === $span['kind'] && false !== stripos( $span['sql'], 'wp_customer_notes' ) ) {
				$span['sql'] = 'SELECT /* removed */ 1';
			}
		}
	}
	return $payload;
} );
```

The app validates every report. A report that breaks the format is refused with `400` and dropped. Keep `sql` non-empty, and keep the field types.

## Reading wrapped callbacks

On traced requests, hook callbacks of plugins and themes are wrapper objects. If your code reads `$wp_filter` or `WP_Hook::$callbacks` directly, call `get_wrapped_callback()` on a wrapper to get the original callable.
