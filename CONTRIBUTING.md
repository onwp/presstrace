# Contributing to PressTrace

Bug reports, fixes and docs changes are welcome. For a larger change, open an issue first so we can agree on the approach before you write the code. Questions go to the places listed in [SUPPORT.md](SUPPORT.md), and security problems go through [SECURITY.md](SECURITY.md), never a public issue.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

The repository has three parts, and each has its own README:

- [`plugin/presstrace/`](plugin/presstrace/README.md): the WordPress agent (PHP 7.4+).
- [`app/`](app/README.md): the app (Hono server, React dashboard, ClickHouse).
- [`docs-site/`](docs-site/README.md): the documentation site (VitePress).

You need Docker, Node.js 24 with pnpm 10 (`corepack enable` sets it up), PHP 8.x with Composer, and [ddev](https://ddev.com) if you want the WordPress lab.

## Run the app

```sh
cd app
cp .env.example .env     # fill in ADMIN_PASSWORD, SESSION_SECRET and CLICKHOUSE_PASSWORD
docker compose up -d --build
```

The dashboard is at http://localhost:8080. `--build` builds the image from your working copy. Without it, Compose pulls the published image.

## The WordPress lab

The lab is a ddev WordPress site with the plugin and the [lab scenarios plugin](dev/lab-scenarios/README.md) mounted from your clone, so edits apply right away. Create a WordPress project with `ddev config --project-type=wordpress`, then add `.ddev/docker-compose.presstrace.yaml`:

```yaml
services:
  web:
    volumes:
      - /path/to/presstrace/plugin/presstrace:/var/www/html/web/wp-content/plugins/presstrace
      - /path/to/presstrace/dev/lab-scenarios:/var/www/html/web/wp-content/plugins/presstrace-lab-scenarios
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Change the paths (and `web/` if your docroot differs), run `ddev restart`, activate both plugins, and use `http://host.docker.internal:8080` as the app URL. The [development page](docs-site/reference/development.md) has the details.

## Run the tests

Plugin (no WordPress or database needed):

```sh
cd plugin/presstrace
composer install
composer test     # PHPUnit
composer lint     # PHP_CodeSniffer with WordPress-Extra and PHPCompatibilityWP
```

App:

```sh
cd app
pnpm install
pnpm typecheck
pnpm test                                              # unit tests
docker compose -f docker-compose.test.yml up -d --wait # throwaway ClickHouse on port 18123
pnpm test:integration
E2E_BASE_URL=http://localhost:8080 E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... pnpm test:e2e
```

The end-to-end tests need a running app and drive it with Playwright.

Docs:

```sh
cd docs-site
pnpm install
pnpm build
```

CI runs the plugin tests, the app checks and the docs build on every push and pull request. Run the end-to-end tests and `composer lint` yourself before you open a pull request.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- Update the docs in `docs-site/` when behaviour changes.
- Write commit messages as a short imperative line, for example `Fix N+1 detection for options queries`.
- Docs and UI text are plain English with no em dashes and no emojis.

## Releases

Maintainers cut a release like this:

1. Run `bin/bump-version.sh <x.y.z>`. It writes the version into the plugin header and constants, `readme.txt`, both `package.json` files, `app/.env.example` and the lab plugin.
2. Add the `## [x.y.z] - <date>` section to `CHANGELOG.md` and a `= x.y.z =` entry to the changelog in `plugin/presstrace/readme.txt`.
3. Regenerate `plugin/presstrace/languages/presstrace.pot` (see the [plugin README](plugin/presstrace/README.md#development)).
4. Run `bin/bump-version.sh --check` and `bin/build-plugin.sh`, then tag `vx.y.z` and push the tag. The release workflow builds the plugin zip, the app bundle and the Docker image.

## License of contributions

PressTrace is source-available, not open source. Read [Licensing](README.md#licensing) in the README before you contribute.

By submitting a contribution (code, docs, translations or anything else), you confirm that you have the right to submit it, and you grant Serhat Aksakal, the maintainer, a perpetual, worldwide, irrevocable, royalty-free license to use, copy, modify, relicense, sublicense and distribute it under any license, including commercial licenses. You keep the copyright in your contribution.

Contributions to the WordPress plugin in `plugin/presstrace/` are also licensed to everyone under GPL-2.0-or-later, the license of the plugin.

The [PolyForm Strict License](LICENSE) that covers the rest of the repository gives no right to make changes to the software. The maintainer allows one exception: you may change a copy to prepare a contribution to this repository. A fork on GitHub exists only under the GitHub Terms of Service, which let other users view and fork public repositories on GitHub. It gives no right to use, run or distribute a modified copy anywhere else.
