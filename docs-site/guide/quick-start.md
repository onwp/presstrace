# Quick start

This path takes about 10 minutes. At the end you have the app running and one WordPress site sending data.

You need:

- A server or laptop with Docker and Docker Compose. The default memory limits of the two containers add up to about 2 GB.
- A WordPress 6.0+ site on PHP 7.4+ where you can install plugins and edit `wp-config.php`.
- For a server on the internet: a domain name pointing at it, so a reverse proxy can serve the app over HTTPS. On a laptop or a private network you can skip this.

## 1. Start the app

Download `presstrace-app-<version>.tar.gz` from the [latest release](https://github.com/onwp/presstrace/releases), unpack it and create the config file:

```sh
VERSION=0.1.0   # the version of the latest release
curl -fsSLO "https://github.com/onwp/presstrace/releases/download/v$VERSION/presstrace-app-$VERSION.tar.gz"
tar -xzf "presstrace-app-$VERSION.tar.gz"
cd presstrace-app
cp .env.example .env
```

Open `.env` and fill in the three required values:

```sh
ADMIN_PASSWORD=...                    # output of: openssl rand -base64 18 (at least 12 characters)
SESSION_SECRET=...                    # output of: openssl rand -hex 32
CLICKHOUSE_PASSWORD=...               # output of: openssl rand -hex 16
```

Also set `ADMIN_EMAIL` to the email you sign in with. The default is `admin@example.com`.

Then decide how browsers and WordPress sites reach the app. Compose publishes port 8080 on `127.0.0.1` only, so on a remote server nothing outside the machine can connect until you pick one of these:

- For production, put a reverse proxy with HTTPS in front. Change these two lines in `.env`:

  ```sh
  PUBLIC_URL=https://apm.example.com
  TRUST_PROXY=true
  ```

  Then install Caddy or nginx on the same server and point it at `127.0.0.1:8080`. A complete Caddy config is three lines: see [HTTPS with a reverse proxy](/app/https).

- On a laptop or a trusted private network, you can connect to the port directly. Open it on every interface and use the server's address:

  ```sh
  APP_BIND=0.0.0.0
  PUBLIC_URL=http://192.168.1.20:8080
  ```

  Without HTTPS, site keys and the login cookie cross the network in clear text. On the laptop itself, the default `PUBLIC_URL=http://localhost:8080` works without changes.

All variables are listed on [Environment variables](/app/configuration).

Start the two containers:

```sh
docker compose up -d
```

Compose pulls the app image `ghcr.io/onwp/presstrace` and ClickHouse. The app waits for ClickHouse to be healthy, creates its tables, and listens on port 8080.

## 2. Sign in and add a site

Open `PUBLIC_URL` in a browser and sign in with `ADMIN_EMAIL` (default `admin@example.com`) and `ADMIN_PASSWORD`.

![The PressTrace sign-in form with email and password fields](/screenshots/login.png){.shot}

Click **Add site**, enter a name and the home address of the WordPress site, and click **Add site** again. The app shows the site key once. Copy the two `define()` lines now: the key is stored only as a hash and cannot be shown again.

![The "Docs demo is ready" dialog with three setup steps and a wp-config.php snippet that defines PRESSTRACE_APP_URL and PRESSTRACE_SITE_KEY. The key in the screenshot is masked.](/screenshots/add-site.png){.shot}

## 3. Install the plugin

Download `presstrace-<version>.zip` from the same release. In WordPress, go to **Plugins > Add New > Upload Plugin**, choose that zip, install it and click **Activate**.

## 4. Connect the site

Paste the two lines into `wp-config.php`, above the line `/* That's all, stop editing! */`:

```php
define( 'PRESSTRACE_APP_URL', 'https://apm.example.com' );
define( 'PRESSTRACE_SITE_KEY', 'pt_your_site_key' );
```

You can also type the app URL and key into **Tools > PressTrace** instead.

Then open **Tools > PressTrace** in the WordPress admin:

1. Click **Test connection**. You should see `Connected. The app knows this site as "..."`.
2. Tick **Send traces to the app**, pick a monitoring window (2 hours is the default), and click **Save settings**.

## 5. See the data

Visit a few pages of the site. Within a few seconds the site shows up on the **Sites** page of the app with request counts and timings. Click the site name to open its transactions.

![The Sites page listing one site, APM Lab, with requests, average, p50, p95, error rate, open issues and a trend line](/screenshots/sites.png){.shot}

## Next steps

- If you started with direct access, move the app [behind HTTPS](/app/https) before you connect production sites.
- Read about the [monitoring window and sampling](/plugin/settings) before you leave monitoring on.
- For many sites, set everything in `wp-config.php` with [constants](/plugin/constants).
