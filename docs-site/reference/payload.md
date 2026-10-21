# Payload format

The agent sends one report per traced request. This is format version 1.

## Request

```http
POST {app_url}/api/v1/ingest
Authorization: Bearer pt_<40 hex characters>
Content-Type: application/json
Content-Encoding: gzip
X-PressTrace-Agent: 0.1.0
```

`Content-Encoding: gzip` is optional. The app also detects gzip by its magic bytes and accepts plain JSON.

| Status | Meaning | What the agent does |
|---|---|---|
| `202` | Accepted. Body: `{"ok":true,"accepted":1}` | Nothing. |
| `400` | Not gzip, not JSON, or not a valid payload. The body lists up to 20 problems. | Drops the report. |
| `401` | Missing or unknown site key. | Drops the report. |
| `413` | More than 2 MB, before or after decompression. | Drops the report. |
| `429` | The app has too many rows waiting for ClickHouse. Has `Retry-After: 5`. | Drops the report. |
| `5xx` | Server error. | Drops the report. |

The agent never retries. After a connection failure or timeout it skips sending for 60 seconds.

## Body

All times are milliseconds as floats with up to 3 decimals. `ts` is Unix epoch milliseconds. `start` is milliseconds from the request start.

```json
{
  "v": 1,
  "agent": "0.1.0",
  "env": {
    "php": "8.3.12",
    "wp": "7.1.3",
    "memory_limit_mb": 256,
    "object_cache": false,
    "db_capture": "dropin"
  },
  "transactions": [
    {
      "id": "8f1c2e9a4b7d3f60a1b2c3d4e5f60718",
      "ts": 1792500000123,
      "name": "single-product",
      "type": "frontend",
      "method": "GET",
      "url": "https://shop.example.com/product/album/",
      "status": 200,
      "duration": 5535.61,
      "db_time": 32.1,
      "db_count": 87,
      "http_time": 5002.21,
      "http_count": 1,
      "memory_peak_mb": 48.2,
      "sample_rate": 1.0,
      "user_logged_in": false,
      "spans": [
        {
          "kind": "db",
          "name": "wp_options SELECT",
          "start": 86.12,
          "duration": 0.33,
          "component": "core",
          "sql": "SELECT option_name, option_value FROM wp_options WHERE autoload = 'yes'",
          "rows": 412,
          "error": null,
          "stack": null
        },
        {
          "kind": "http",
          "name": "api.stripe.com POST",
          "start": 191.0,
          "duration": 5002.21,
          "component": "plugin:payment-api-test",
          "url": "https://api.stripe.com/v1/charges",
          "method": "POST",
          "status": 200,
          "error": null,
          "stack": ["class-wc-cart.php:1276 do_action", "class-wp-hook.php:309 WC_Form_Handler::add_to_cart_action"]
        },
        {
          "kind": "callback",
          "name": "update_card_payment",
          "start": 190.4,
          "duration": 5004.0,
          "self": 1.8,
          "component": "plugin:payment-api-test",
          "hook": "action:woocommerce_add_to_cart",
          "file": "wp-content/plugins/payment-api-test/payment.php:42"
        },
        {
          "kind": "plugin_load",
          "name": "woocommerce/woocommerce.php",
          "start": 12.4,
          "duration": 18.9,
          "component": "plugin:woocommerce"
        },
        {
          "kind": "theme_load",
          "name": "storefront",
          "start": 60.2,
          "duration": 4.1,
          "component": "theme:storefront"
        }
      ],
      "components": [
        { "component": "plugin:payment-api-test", "time": 5004.0, "calls": 1 },
        { "component": "plugin:woocommerce", "time": 120.5, "calls": 940 }
      ],
      "errors": [
        {
          "level": "warning",
          "message": "Undefined array key \"foo\"",
          "file": "wp-content/plugins/demo/demo.php",
          "line": 12,
          "component": "plugin:demo"
        }
      ],
      "dropped_spans": 0
    }
  ]
}
```

## Field rules

| Field | Rule |
|---|---|
| `v` | Always `1`. |
| `env.memory_limit_mb` | PHP `memory_limit` in MB, or `-1` when unlimited. |
| `env.object_cache` | `true` when a persistent object cache drop-in is in use. |
| `env.db_capture` | `dropin`, `log_query` or `query_filter`. See [drop-ins](/plugin/drop-ins#when-another-db-php-exists). |
| `transactions` | 1 to 50 items. The agent sends one per request; the array allows batching later. |
| `id` | 16 to 64 hex characters. |
| `type` | `frontend`, `admin`, `rest`, `ajax`, `cron`, `cli`. |
| `url` | Query string removed by the agent. The app removes query strings, fragments and credentials again. |
| `spans` | At most 500. `kind` is `db`, `http`, `callback`, `plugin_load` or `theme_load`. |
| `component` | `core`, `plugin:<slug>`, `mu-plugin:<slug>`, `theme:<slug>`, `dropin:<file>` or `unknown`. |
| `sql` | Cut to 2000 characters by the agent. The app computes the fingerprint. |
| `stack` | Up to 15 `file:line function` strings, paths relative to `ABSPATH`, or `null`. |
| `components` | Self time per non-core component, from callback timing plus its load time. `calls` is the number of wrapped callback runs. At most 500. |
| `errors` | At most 200 in the format, 50 sent by the agent. `level` is `fatal`, `error`, `warning`, `notice`, `deprecated` or `exception`. |
| `dropped_spans` | Spans the agent recorded but did not send because of the 500 limit. |

Duration fields must be between 0 and 86,400,000 ms (one day). The full schema is in `app/src/server/payload.ts`.

## Ping

```http
GET {app_url}/api/v1/ping
Authorization: Bearer pt_<40 hex characters>
```

Returns `200 {"ok":true,"site":{"id":"...","name":"..."}}` for a valid key, `401` otherwise. The Test connection button on the settings page calls it.
