# Settings page

The settings live under **Tools > PressTrace** in the WordPress admin. Only users with the `manage_options` capability can open it. All settings are stored in one option, `presstrace_settings`.

![The PressTrace settings page in WordPress: a Status box with "Monitoring on", a Connection section with App URL, a masked site key and Test connection, a Monitoring section with the window and sample rate, a Drop-ins table, and a "Trace one request" box](/screenshots/wp-settings.png){.shot}

## Status

The first box says what the agent is doing:

| Status | Meaning |
|---|---|
| `Not configured` | The app URL or the site key is missing. |
| `Monitoring off` | The agent is dormant. Either monitoring is switched off, or the window has ended (`The monitoring window ended on ... Save the settings to start a new window.`). |
| `Monitoring on` | Reports are sent. The text shows `Enabled until ...` in site time, or `Traces are sent with no time limit.` for the window **Always**. |

**Open dashboard** opens the app in a new tab.

## Connection

**App URL** is the address of your PressTrace app, for example `https://apm.example.com`. It must start with `http://` or `https://` and must not contain a user name or password. A trailing slash is removed.

**Site key** is the key the app showed when you added the site. It looks like `pt_` followed by 40 hexadecimal characters. The field is never filled in after saving: it shows the saved key masked, as `pt_********23fb`. Leave it empty to keep the saved key. A key in the wrong format is refused, and the previous key is kept.

**Test connection** calls the app with the saved settings, so save first. The answers are listed in [troubleshooting](/app/troubleshooting#test-connection-fails-in-wordpress). On success you see `Connected. The app knows this site as "APM Lab".` with the name of your site.

When a value comes from a [constant](/plugin/constants) in `wp-config.php`, the field is disabled and says, for example, `Set by PRESSTRACE_APP_URL in wp-config.php.`

## Monitoring window

**Send traces to the app** switches monitoring on. **Monitoring window** sets how long it stays on: 2 hours (the default), 4 hours, 12 hours, 24 hours or **Always**.

When the window ends, monitoring turns itself off and the agent goes dormant. Every save while monitoring is on restarts the window from the time of the save. You can turn monitoring on while you look into a problem and let it switch off by itself afterwards.

For sites you want to watch all the time, pick **Always**, or set `PRESSTRACE_ALWAYS_ON` in `wp-config.php`.

## Sample rate

**Sample rate** is the share of requests to trace, from 0 to 1. `1` traces every request, `0.1` traces about one in ten, `0` traces none. Each request is picked at random. Values outside 0 to 1 are clamped, a comma works as the decimal mark, and anything that is not a number becomes 1.

The dashboard scales request counts and rates by `1 / sample rate`, so the traffic numbers stay right. Averages and percentiles come from the sampled requests.

How to choose:

- Small sites, or while you look into a problem: `1`.
- Busy sites that you watch all the time: start at `0.1` and lower it if the app server or its disk struggles. A lower rate also lowers the overhead on the WordPress server, since unsampled requests are not measured at all.
- Rare problems (one slow request a day) need a high rate or [Trace one request](#trace-one-request). Sampling can miss them.

## Drop-ins

This table shows the two files PressTrace installs in `wp-content`:

| File | Status | Meaning |
|---|---|---|
| `mu-plugins/000-presstrace.php` | `Installed. The agent starts before other plugins.` | Normal. |
| | `Missing. The agent starts late and misses some plugin load times.` | The loader could not be written. |
| | `Another file with this name exists. Remove it and reinstall.` | A file that is not ours is in the way. |
| `db.php` | `Installed. Every query is timed.` | Normal. |
| | A message about another database drop-in | Fallback mode. See [drop-ins](/plugin/drop-ins#when-another-db-php-exists). |
| | `Missing. Reinstall to time every query.` | No `db.php` at all. |
| either | `Installed, older version. Reinstall to update it.` | Left over from an older plugin version. |

**Reinstall drop-ins** writes both files again. It never replaces a `db.php` that belongs to another plugin.

## Trace one request

While logged in as an administrator, add `?presstrace_force=1` to any URL:

```text
https://example.com/shop/?presstrace_force=1
https://example.com/wp-admin/edit.php?presstrace_force=1
```

That request is traced even when monitoring is off or the request would not be sampled. The app URL and site key must be saved. The agent checks the `manage_options` capability once WordPress has loaded the user, and drops the trace for anyone else. A request that ends before `init` is dropped too.

## Mobile

The settings page works on small screens. Fields go full width and the sections stack.

![The PressTrace settings page on a 390 pixel wide phone screen](/screenshots/wp-settings-mobile.png){.shot .shot-mobile}
