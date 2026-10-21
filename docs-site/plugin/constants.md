# wp-config constants

Constants in `wp-config.php` override the settings page. They suit hosting fleets, where you roll out the same config to many sites with your provisioning tools. Put them above the line `/* That's all, stop editing! */`.

| Constant | Type | What it does |
|---|---|---|
| `PRESSTRACE_APP_URL` | string | The app URL. Same rules as the settings field: `http://` or `https://`, no credentials. An invalid value counts as empty. |
| `PRESSTRACE_SITE_KEY` | string | The site key, `pt_` followed by 40 hexadecimal characters. An invalid value counts as empty. |
| `PRESSTRACE_SAMPLE_RATE` | number | Share of requests to trace, from 0 to 1. Clamped to that range. |
| `PRESSTRACE_ALWAYS_ON` | bool | When true, monitoring is on with the window **Always**, whatever the settings page says. |
| `PRESSTRACE_TRACE_CLI` | bool | When true, WP-CLI commands are traced too (type `cli`). Off by default. |
| `PRESSTRACE_DISABLE_UPDATE_CHECK` | bool | When true, the plugin does not ask GitHub for new releases, and WordPress shows no PressTrace updates. See [upgrading the plugin](/plugin/#upgrading-the-plugin). |
| `PRESSTRACE_LAB` | bool | Only read by the PressTrace Lab Scenarios development plugin. See [development](/reference/development). Never set it on a real site. |

When a constant is set, its field on **Tools > PressTrace** is disabled and shows `Set by ... in wp-config.php`. Saving the page keeps the stored values underneath, so removing the constant later brings them back.

## Example for a fleet

```php
// PressTrace APM
define( 'PRESSTRACE_APP_URL', 'https://apm.example.com' );
define( 'PRESSTRACE_SITE_KEY', 'pt_0123456789abcdef0123456789abcdef01234567' );
define( 'PRESSTRACE_SAMPLE_RATE', 0.1 );
define( 'PRESSTRACE_ALWAYS_ON', true );
```

Each site needs its own key. Add the site in the app first, then write the key into that site's `wp-config.php`.

With WP-CLI:

```sh
wp config set PRESSTRACE_APP_URL 'https://apm.example.com'
wp config set PRESSTRACE_SITE_KEY 'pt_0123456789abcdef0123456789abcdef01234567'
wp config set PRESSTRACE_SAMPLE_RATE 0.1 --raw
wp config set PRESSTRACE_ALWAYS_ON true --raw
```

## Tracing WP-CLI

With `PRESSTRACE_TRACE_CLI` set to true, every WP-CLI command on the site is traced and sent, subject to monitoring and the sample rate. `?presstrace_force=1` has no effect on the command line. Leave this off unless you are looking into a slow command or cron job run from WP-CLI.
