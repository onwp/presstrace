# License

PressTrace is source-available. You can read all of its code, but it is not open source in the OSI sense, because the license limits how you may use it.

## Two licenses

| Part | License |
|---|---|
| The app, the dashboard, the docs, the scripts and the rest of the repository | [PolyForm Strict License 1.0.0](https://github.com/onwp/presstrace/blob/main/LICENSE) |
| The WordPress plugin in `plugin/presstrace/` and the development plugin in `dev/lab-scenarios/` | [GPL-2.0-or-later](https://github.com/onwp/presstrace/blob/main/plugin/presstrace/LICENSE) |

The plugins run inside WordPress, which is GPL software, so they are GPL as well. The plugin zip contains its own `LICENSE` file.

## What the PolyForm Strict License allows

You may download, install and run PressTrace for free for a noncommercial purpose. That covers personal use: your personal sites, hobby projects, study and testing. The license also allows use by charities, schools and universities, public research, public safety and health organizations, and government institutions.

You may not:

- use it for a commercial purpose, which includes a company running it internally to monitor its own sites, and an agency or host monitoring client sites
- redistribute it, in source or binary form, including as a Docker image
- sell it or offer it as a hosted service
- white-label or rebrand it
- make changes to it or build new works on it

The full text is in the [LICENSE](https://github.com/onwp/presstrace/blob/main/LICENSE) file.

## Commercial license

Commercial use, including use inside a company, needs a separate license. To ask about one, contact the author through the GitHub profile at [github.com/onwp](https://github.com/onwp).

## Trademarks

The PressTrace name and logo are reserved by the author. You may not use them for forks, rebranded or white-labeled versions, hosted services or products, and that includes forks of the GPL plugin. You may say that something works with PressTrace. See [TRADEMARKS.md](https://github.com/onwp/presstrace/blob/main/TRADEMARKS.md).

## Contributions

Contributions are welcome under the terms in [CONTRIBUTING.md](https://github.com/onwp/presstrace/blob/main/CONTRIBUTING.md#license-of-contributions). In short, you let the maintainer use and relicense your contribution under any license, and plugin contributions are also GPL-2.0-or-later.

## Third-party software

The app uses open source packages under the MIT and Apache-2.0 licenses: Hono, React, React Router, Zod and the ClickHouse client. The Docker image is based on the official Node.js Alpine image. ClickHouse runs as its own container from the official image under the Apache-2.0 license. Each package keeps its own license.
