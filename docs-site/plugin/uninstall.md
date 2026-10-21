# Uninstall

## Deactivate

Deactivating the plugin removes `wp-content/mu-plugins/000-presstrace.php` and `wp-content/db.php`, but only when they are PressTrace files. Another plugin's `db.php` stays. Your settings stay in the database, and reactivating the plugin puts the files back with the same settings.

## Delete

Deleting the plugin from **Plugins** runs `uninstall.php`, which removes:

- the loader mu-plugin and the PressTrace `db.php`, if they are still there,
- the `presstrace_settings` option and the `presstrace_sync_failed` transient, on every site of a multisite network,
- the cached release lookup (the `presstrace_latest_release` site transient),
- the `presstrace-backoff-*` marker files in the PHP temp folder, which the agent uses to pause sending after a failed send.

PressTrace stores no other data on the site. Remove any `PRESSTRACE_*` constants from `wp-config.php` yourself.

## Remove the site from the app

Uninstalling the plugin does not touch the app. To stop accepting reports from that site and hide it from the dashboard, open the site in the app, go to **Setup** and click **Remove site**. See [site setup](/dashboard/setup#remove-a-site).
