import { defineConfig } from "vitepress";

// Set DOCS_BASE when the site is served from a sub-path, for example DOCS_BASE=/presstrace-wordpress-apm/ on GitHub Pages.
const base = process.env.DOCS_BASE || "/";

export default defineConfig({
  base,
  srcExclude: ["README.md"],
  lang: "en-US",
  title: "PressTrace",
  description: "Source-available APM for WordPress: a plugin agent and a self-hosted app.",
  cleanUrls: true,
  lastUpdated: false,
  markdown: { image: { lazyLoading: true } },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }],
    ["meta", { name: "theme-color", content: "#1d4ed8" }],
  ],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "" },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/onwp/presstrace-wordpress-apm" }],
    outline: { level: [2, 3], label: "On this page" },
    nav: [
      { text: "Guide", link: "/guide/introduction", activeMatch: "^/guide/" },
      { text: "Install", link: "/app/", activeMatch: "^/(app|plugin)/" },
      { text: "Dashboard", link: "/dashboard/", activeMatch: "^/dashboard/" },
      { text: "Issues", link: "/issues/", activeMatch: "^/issues/" },
      { text: "Reference", link: "/reference/payload", activeMatch: "^/reference/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "How it works", link: "/guide/how-it-works" },
          { text: "Quick start", link: "/guide/quick-start" },
        ],
      },
      {
        text: "Install the app",
        items: [
          { text: "Requirements and Docker Compose", link: "/app/" },
          { text: "Environment variables", link: "/app/configuration" },
          { text: "HTTPS with a reverse proxy", link: "/app/https" },
          { text: "Upgrades, backups, retention", link: "/app/operations" },
          { text: "Troubleshooting", link: "/app/troubleshooting" },
        ],
      },
      {
        text: "Install the plugin",
        items: [
          { text: "Install and connect", link: "/plugin/" },
          { text: "Settings page", link: "/plugin/settings" },
          { text: "wp-config constants", link: "/plugin/constants" },
          { text: "Drop-ins and compatibility", link: "/plugin/drop-ins" },
          { text: "Filters for developers", link: "/plugin/developers" },
          { text: "Uninstall", link: "/plugin/uninstall" },
        ],
      },
      {
        text: "Using the dashboard",
        items: [
          { text: "Sites and navigation", link: "/dashboard/" },
          { text: "Transactions", link: "/dashboard/transactions" },
          { text: "Samples and traces", link: "/dashboard/traces" },
          { text: "WordPress", link: "/dashboard/wordpress" },
          { text: "Database", link: "/dashboard/database" },
          { text: "External", link: "/dashboard/external" },
          { text: "Errors", link: "/dashboard/errors" },
          { text: "Issues", link: "/dashboard/issues" },
          { text: "Site setup", link: "/dashboard/setup" },
        ],
      },
      {
        text: "Issues reference",
        items: [{ text: "All detection types", link: "/issues/" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Payload format", link: "/reference/payload" },
          { text: "API endpoints", link: "/reference/api" },
          { text: "Data and privacy", link: "/reference/privacy" },
          { text: "Overhead", link: "/reference/overhead" },
          { text: "Security", link: "/reference/security" },
          { text: "Known limitations", link: "/reference/limitations" },
          { text: "FAQ", link: "/reference/faq" },
          { text: "Development", link: "/reference/development" },
          { text: "License", link: "/reference/license" },
        ],
      },
    ],
    footer: {
      message:
        `Source-available under the <a href="${base}reference/license">PolyForm Strict License 1.0.0</a>. The WordPress plugin is GPL-2.0-or-later.`,
      copyright: "Copyright 2026 Serhat Aksakal",
    },
    docFooter: { prev: "Previous page", next: "Next page" },
  },
});
