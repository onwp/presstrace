# HTTPS with a reverse proxy

The app speaks plain HTTP. In production, put a reverse proxy in front of it that handles TLS. Site keys and the session cookie then travel encrypted.

## Settings for a proxy

In `app/.env`:

```sh
PUBLIC_URL=https://apm.example.com
TRUST_PROXY=true
APP_BIND=127.0.0.1
APP_PORT=8080
```

- `PUBLIC_URL` must be the exact HTTPS address that browsers and WordPress use. Sign-in and other changes from the dashboard are only accepted from this origin. An `https://` value turns on the `Secure` cookie flag and the `Strict-Transport-Security: max-age=31536000` header (HSTS), so a browser that saw the app over HTTPS once refuses plain HTTP to that host name for a year. Only switch to `https://` once HTTPS works.
- `TRUST_PROXY=true` makes the login rate limit use the client address from `X-Forwarded-For` (the rightmost entry, which your proxy adds). Without it, every client looks like the proxy.
- `APP_BIND=127.0.0.1` is the default. Compose then publishes the app only on the loopback interface, so nobody can skip the proxy. WordPress servers on other hosts send their reports through the proxy, to `PUBLIC_URL`. If the app logs `TRUST_PROXY is on and the app is reachable on all interfaces`, `APP_BIND` is `0.0.0.0`, and clients that connect to the port directly could fake `X-Forwarded-For`.

## Without a proxy

On a private network you can skip the proxy and let WordPress servers connect to the port directly. Set `APP_BIND=0.0.0.0` so Compose publishes the port on every interface, keep `TRUST_PROXY=false`, and use `http://` in `PUBLIC_URL`. Site keys and the session cookie then cross the network unencrypted, so only do this where you trust the network.

Then recreate the app container:

```sh
docker compose up -d --force-recreate app
```

## Caddy

Caddy gets and renews a certificate by itself. A complete `Caddyfile`:

```txt
apm.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy sets `X-Forwarded-For` to the address of the client it sees, so the rightmost entry is the real client.

## nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name apm.example.com;

    ssl_certificate     /etc/letsencrypt/live/apm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apm.example.com/privkey.pem;

    # Agent reports can be up to 2 MB. The nginx default is 1 MB.
    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name apm.example.com;
    return 301 https://$host$request_uri;
}
```

`$proxy_add_x_forwarded_for` appends the client address that nginx saw, so the rightmost entry is the real client.

## Update the WordPress sites

Change the app URL on every site to the HTTPS address. With constants:

```php
define( 'PRESSTRACE_APP_URL', 'https://apm.example.com' );
```

Then click **Test connection** on **Tools > PressTrace**. The agent does not follow redirects when it sends reports, so an old `http://` URL that only redirects to HTTPS stops working. Use the final URL.
