# PressTrace docs site

The source of the [PressTrace documentation](https://onwp.github.io/presstrace-wordpress-apm/), built with [VitePress](https://vitepress.dev). Back to the [main README](../README.md).

## Run, build, preview

You need Node.js 24 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev       # local server with hot reload
pnpm build     # static site in .vitepress/dist
pnpm preview   # serve the built site
```

The site is served from `/` by default. When it lives under a sub-path, set `DOCS_BASE`, which is what the GitHub Pages build does:

```sh
DOCS_BASE=/presstrace-wordpress-apm/ pnpm build
```

## Layout

| Path | Pages |
|---|---|
| `guide/` | Introduction, how it works, quick start. |
| `app/` | Installing and running the app. |
| `plugin/` | Installing and configuring the plugin. |
| `dashboard/` | One page per dashboard screen. |
| `issues/` | Every issue type the app detects. |
| `reference/` | Payload, API, privacy, overhead, security, limitations, FAQ, development. |
| `public/screenshots/` | The screenshots used on the pages and in the READMEs. |
| `.vitepress/config.mts` | Navigation, sidebar and the `DOCS_BASE` setting. |

## Retake the screenshots

`pnpm screenshots` signs in to a running app, opens the site named `APM Lab`, and writes PNGs to `public/screenshots/`. It masks site keys before each capture. It loads Playwright from `app/node_modules`, so run `pnpm install` in `../app` first.

Settings come from environment variables. `PT_PASSWORD` (the dashboard password) and `PT_WP_URL` (the WordPress site that runs the plugin) are required, for example `PT_PASSWORD=... PT_WP_URL=https://wp.example.test pnpm screenshots`. The optional ones are `PT_APP_URL` (default `http://localhost:8080`), `PT_EMAIL`, `PT_SITE_NAME`, `PT_RANGE`, `PT_WP_USER` and `PT_WP_PASSWORD`. When `python3` with Pillow is installed, the script reduces the PNGs to 256 colors. Generate some traffic with the [lab scenarios](../dev/lab-scenarios/README.md) first so every page has data.

## Deploy

[`.github/workflows/docs.yml`](../.github/workflows/docs.yml) builds the site with `DOCS_BASE=/presstrace-wordpress-apm/` and publishes it to GitHub Pages on every push to `main` that touches `docs-site/`. You can also start it by hand from the Actions tab.

## Writing guidelines

- Plain, direct English. Say what the thing does, with the real names of buttons, settings and messages, in bold for UI labels.
- No em dashes or en dashes, no emojis, and no sales language. Cut filler, staged contrasts, one-line closers and inflated claims.
- Sentence case for headings.
- Every claim must match the code. Numbers such as overhead and sizes come from lab measurements, so say where they come from.
- Use absolute links inside the site (`/plugin/constants`) and `/screenshots/...` for images. VitePress adds the base path.
- Write alt text that describes what the screenshot shows.
