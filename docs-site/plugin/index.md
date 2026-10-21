# Install the plugin

The plugin is the PressTrace agent. It needs PHP 7.4 or newer and WordPress 6.0 or newer. It has been tested up to WordPress 7.1.

## Get the zip

The plugin is not in the WordPress.org directory. Download `presstrace-<version>.zip` from the [GitHub releases](https://github.com/onwp/presstrace/releases), for example `presstrace-0.1.0.zip`.

To build it from source instead, run this from the root of a clone:

```sh
bin/build-plugin.sh
```

The script reads the version from `plugin/presstrace/presstrace.php` and writes `dist/presstrace-<version>.zip`, for example `dist/presstrace-0.1.0.zip`. It prints the path when it is done. The zip holds one `presstrace/` folder with only the runtime files (`presstrace.php`, `uninstall.php`, `readme.txt`, `src`, `dropins`, `assets`, `languages`), without tests, Composer files or dotfiles. You need `bash` and `zip`.

## Install from the zip

1. In WordPress, go to **Plugins > Add New > Upload Plugin**.
2. Choose the zip and click **Install Now**.
3. Click **Activate**.

You can also unzip it into `wp-content/plugins/` yourself, or install it with WP-CLI:

```sh
wp plugin install presstrace-0.1.0.zip --activate
```

## What activation does

- It copies the loader to `wp-content/mu-plugins/000-presstrace.php`, so the agent starts before every other plugin.
- It writes `wp-content/db.php`, the database drop-in that times every query, but only when no `db.php` exists yet. If one exists, for example from Query Monitor, PressTrace leaves it alone and uses a [fallback](/plugin/drop-ins#when-another-db-php-exists).
- It does not turn on monitoring. Nothing is sent until you connect the site and switch monitoring on.

The web server must be able to write to both folders. If the loader cannot be written, the Plugins screen shows `PressTrace could not install its loader in wp-content/mu-plugins, so some plugin load times are not measured.`

## Connect the site

You need the app URL and the site key from [Add site](/dashboard/setup) in the app. There are two ways to set them.

On one site, go to **Tools > PressTrace**, fill in **App URL** and **Site key**, and click **Save settings**. Then click **Test connection**. The [settings page](/plugin/settings) explains every field.

On many sites, put the values in `wp-config.php`, above the line `/* That's all, stop editing! */`:

```php
define( 'PRESSTRACE_APP_URL', 'https://apm.example.com' );
define( 'PRESSTRACE_SITE_KEY', 'pt_0123456789abcdef0123456789abcdef01234567' );
```

Constants override the settings page. See [wp-config constants](/plugin/constants) for the full list.

Then switch monitoring on, either on the settings page or with `PRESSTRACE_ALWAYS_ON`.

## Upgrading the plugin

WordPress shows PressTrace updates on the **Plugins** page and under **Dashboard > Updates**, like any other plugin. The plugin header sets `Update URI: https://github.com/onwp/presstrace`, so WordPress never offers a WordPress.org plugin with the same slug in its place. PressTrace looks up the latest stable GitHub release (prereleases are skipped) and offers its `presstrace-<version>.zip`. The answer is cached for 12 hours, and a failed lookup is retried after an hour. To turn the check off, set `PRESSTRACE_DISABLE_UPDATE_CHECK` to `true` in `wp-config.php` (see [constants](/plugin/constants)).

To update by hand, download the new zip (or build it) and upload it again with **Plugins > Add New > Upload Plugin**. WordPress asks whether to replace the installed version. Your settings are kept.

The loader and the `db.php` drop-in carry a version number. The next time an administrator opens a wp-admin page, PressTrace replaces outdated copies of both. The **Drop-ins** table on **Tools > PressTrace** shows `Installed, older version. Reinstall to update it.` if that did not work, and **Reinstall drop-ins** retries.

If you replace `db.php` from WP-CLI, PHP-FPM can keep running the old file from its opcache. Reload PHP-FPM afterwards. Activating the plugin from wp-admin clears the cached file by itself.
