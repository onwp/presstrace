# Site setup

## Add a site

On the **Sites** page, click **Add site**. Enter:

- Name: up to 100 characters, for example `Shop production`.
- URL: the home address of the site, starting with `http://` or `https://`, for example `https://shop.example.com`. It is for display, so a wrong URL does not stop data from arriving.

The app creates the site and shows its key once, inside a `wp-config.php` snippet:

![The "is ready" dialog after adding a site: a warning to copy the key now, three setup steps, and a wp-config.php snippet with PRESSTRACE_APP_URL and PRESSTRACE_SITE_KEY. The key in the screenshot is masked.](/screenshots/add-site.png){.shot}

The key is `pt_` followed by 40 hexadecimal characters. The app stores only its SHA-256 hash, so it cannot show the key again. Copy it now, then follow the steps in [install the plugin](/plugin/).

## The Setup page

Each site has a **Setup** section.

![The Setup page of APM Lab: connection steps with a wp-config.php snippet that uses a placeholder key, a Status card with last data, key hint, creation date, PHP, WordPress and agent versions, and a Details form for name and URL](/screenshots/settings.png){.shot}

- **Connect WordPress** repeats the setup steps. The snippet uses `pt_your_site_key`, since the real key is not stored.
- **Status** shows when data last arrived, the start and end of the key (`pt_c682...23fb`), when the site was created, and the PHP, WordPress and agent versions from the latest report.
- **Details** changes the name and URL.

## Rotate the key

**Rotate site key** creates a new key and stops the old one right away. The new key is shown once on the page. Until `wp-config.php` (or the settings page) on the site has the new key, the site's reports are rejected with `401`.

Rotate when a key may have leaked, when someone who knew it leaves, or when you lost it.

## Remove a site

**Remove site** hides the site from the dashboard and rejects its key. Stored data is not deleted and expires with the normal [retention](/app/operations#retention). Uninstall the plugin on the site too, so it stops sending.
