---
layout: home
title: PressTrace
titleTemplate: Self-hosted APM for WordPress

hero:
  name: PressTrace
  text: Find out why a WordPress site is slow
  tagline: A self-hosted, source-available APM. A WordPress plugin measures each request, and your own server shows slow plugins, hooks, queries, external calls and PHP errors. It needs no PHP extension.
  image:
    src: /logo.svg
    alt: ""
  actions:
    - theme: brand
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: How it works
      link: /guide/how-it-works

features:
  - title: Slow transactions
    details: Every page view, admin screen, REST call, AJAX action and cron run, with p50, p95 and the split between PHP, MySQL and external time.
    link: /dashboard/transactions
  - title: Plugins and hooks
    details: Self time per plugin and theme, the slowest hook callbacks, and how long each plugin takes to load.
    link: /dashboard/wordpress
  - title: Database queries
    details: Queries grouped by shape, with the plugin or theme that ran them and a stack trace for queries of 1 ms or more.
    link: /dashboard/database
  - title: External calls
    details: Calls made through the WordPress HTTP API, grouped by host and method, with failures and status codes.
    link: /dashboard/external
  - title: Detected issues
    details: N+1 queries, duplicate queries, slow plugins, failed API calls, PHP fatals and more, each with a fix written for WordPress.
    link: /issues/
  - title: Self-hosted
    details: Two containers (the app and ClickHouse) on your own server. Many sites send to one app. The plugin stores nothing but its settings.
    link: /app/
---

## What you get

PressTrace has two parts. The plugin runs inside WordPress and records what each traced request did. The app receives those reports, stores them in ClickHouse and shows them in a dashboard.

![The Transactions page of a site in the PressTrace dashboard: request count, average, p50, p95, error rate, and a stacked bar chart of PHP, MySQL and external time per 2-minute bar](/screenshots/transactions.png){.shot}

The trace view shows one request as a timeline. Here, a plugin callback waited 808 ms for an external API, which was 91% of the request.

![A trace of a front-page request: duration 887 ms, a breakdown bar with external time dominant, the issues found in the request, and a timeline sorted by duration where one external call is marked "Over 25%"](/screenshots/trace.png){.shot}

PressTrace is source-available and free for personal and noncommercial use. The WordPress plugin is GPL-2.0-or-later. See [License](/reference/license) for what is allowed and how to get a commercial license.
