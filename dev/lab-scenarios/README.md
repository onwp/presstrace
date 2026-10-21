# PressTrace Lab Scenarios

A development plugin that makes WordPress requests slow or broken on purpose, so you can check that the [PressTrace plugin](../../plugin/presstrace/README.md) records them and the app raises the right issues. Back to the [main README](../../README.md).

It only runs when `WP_DEBUG` or `PRESSTRACE_LAB` is true. Never install it on a real site.

## Use

Activate it in a test site such as the ddev lab from [CONTRIBUTING.md](../../CONTRIBUTING.md), then add `?pt_scenario=` to any URL. Commas combine scenarios, for example `/?pt_scenario=slow_hook,n_plus_one`.

| Scenario | What it does | Issue it raises |
|---|---|---|
| `slow_hook` | A callback that blocks for 300 ms. `&pt_ms=N` (1 to 10000) changes it. | Slow plugin, slow transaction |
| `n_plus_one` | The same query shape 30 times, with the meta cache cleared each time. | N+1 query |
| `slow_query` | `SELECT SLEEP(0.3)`. | Slow query |
| `slow_external` | An 800 ms call to the app's `/api/v1/debug/delay`, with the site key. The app only has that route with `ENABLE_DEBUG_ROUTES=1`; otherwise the scenario calls `https://httpbin.org/delay/1` instead. | Slow external request |
| `failed_external` | A call to port 9, where nothing listens. | Failed external request |
| `php_warning` | A warning, a notice and a deprecation. | PHP warning |
| `fatal` | A call to an undefined function. | PHP fatal error |
| `exception` | An uncaught exception. | Uncaught exception |
| `many_queries` | 150 small queries. `&pt_queries=N` (1 to 2000) changes it. | Too many queries |
| `select_star` | `SELECT * FROM wp_posts LIMIT 20`. | SELECT * query |
| `memory` | Raises peak memory to about 85% of a 256 MB limit. | High memory usage |

To make sure the request is traced, turn monitoring on with a sample rate of 1, or add `&presstrace_force=1` while logged in as an administrator. More in [development](https://onwp.github.io/presstrace-wordpress-apm/reference/development#lab-scenarios).
