// Takes the documentation screenshots from a running PressTrace app and a WordPress site that runs the plugin.
// Run with `pnpm screenshots` from docs-site/. Settings come from environment variables.
// PT_PASSWORD (the dashboard password) and PT_WP_URL (the WordPress site) are required; the rest have defaults:
//   PT_APP_URL, PT_EMAIL, PT_SITE_NAME, PT_RANGE, PT_WP_USER, PT_WP_PASSWORD
// Playwright is loaded from the app's devDependencies, so run `pnpm install` in app/ first.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../app/package.json"));
const { chromium } = require("playwright");

const APP = (process.env.PT_APP_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const EMAIL = process.env.PT_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.PT_PASSWORD ?? "";
const SITE_NAME = process.env.PT_SITE_NAME ?? "APM Lab";
const RANGE = process.env.PT_RANGE ?? "1h";
const WP = (process.env.PT_WP_URL ?? "").replace(/\/+$/, "");
const WP_USER = process.env.PT_WP_USER ?? "admin";
const WP_PASSWORD = process.env.PT_WP_PASSWORD ?? "admin";
const OUT = path.join(here, "../public/screenshots");

if (!PASSWORD || !WP) {
  console.error("Set PT_PASSWORD to the dashboard password and PT_WP_URL to the WordPress site that runs the plugin.");
  process.exit(1);
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

mkdirSync(OUT, { recursive: true });

/** Replaces every full site key on the page with a masked one, in text and in form fields. */
async function maskKeys(page) {
  await page.evaluate(() => {
    const re = /pt_[0-9a-f]{40}/g;
    const mask = (s) => s.replace(re, (k) => `pt_${"*".repeat(8)}${k.slice(-4)}`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (re.test(n.nodeValue)) n.nodeValue = mask(n.nodeValue);
      re.lastIndex = 0;
    }
    for (const el of document.querySelectorAll("input, textarea")) {
      if (re.test(el.value)) el.value = mask(el.value);
      re.lastIndex = 0;
    }
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction(() => !document.querySelector('[role="status"][aria-busy="true"]') && !/^Loading/m.test(document.body.innerText), null, {
      timeout: 10_000,
    })
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function shot(page, name, { full = false, maxHeight = 0 } = {}) {
  await settle(page);
  await maskKeys(page);
  const file = path.join(OUT, `${name}.png`);
  const options = { path: file, fullPage: full || maxHeight > 0, animations: "disabled", caret: "hide" };
  if (maxHeight > 0) {
    const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: document.documentElement.scrollHeight }));
    options.clip = { x: 0, y: 0, width, height: Math.min(height, maxHeight) };
  }
  await page.screenshot(options);
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

async function newContext(browser, { viewport = DESKTOP, theme = "light", storageState } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 2 : 1,
    colorScheme: theme,
    ignoreHTTPSErrors: true,
    storageState,
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("pt-theme", t);
    } catch {}
  }, theme);
  return context;
}

async function api(context, method, url, data) {
  const res = await context.request.fetch(`${APP}${url}`, {
    method,
    data,
    headers: { Origin: APP },
  });
  if (!res.ok()) throw new Error(`${method} ${url} answered ${res.status()}: ${await res.text()}`);
  return res.json();
}

const browser = await chromium.launch();
try {
  // ------------------------------------------------------------------ login (light, desktop)
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await shot(page, "login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const storageState = await ctx.storageState();

  const { sites } = await api(ctx, "GET", `/api/sites?range=${RANGE}`);
  const site = sites.find((s) => s.name === SITE_NAME);
  if (!site) throw new Error(`No site named "${SITE_NAME}" in the app.`);
  const base = `${APP}/sites/${site.id}`;
  const q = `?range=${RANGE}`;

  // Pick a trace with a slow external call, else the slowest transaction.
  const ext = await api(ctx, "GET", `/api/sites/${site.id}/external${q}`);
  const slowHost = ext.rows.sort((a, b) => b.total - a.total)[0];
  const samples = slowHost
    ? await api(ctx, "GET", `/api/sites/${site.id}/samples${q}&by=external&key=${encodeURIComponent(`${slowHost.method} ${slowHost.host}`)}`)
    : null;
  const pick = samples?.highlights?.find((h) => h.label === "p50") ?? samples?.highlights?.[0];
  const traceId = pick?.sample?.transactionId ?? samples?.recent?.[0]?.transactionId;

  // Pick an issue to show in detail: slow external first, then the most frequent one.
  const { issues } = await api(ctx, "GET", `/api/sites/${site.id}/issues${q}`);
  const issue = issues.find((i) => i.type === "slow_external") ?? issues[0];

  // ------------------------------------------------------------------ desktop, light
  await page.goto(`${APP}/${q}`);
  await shot(page, "sites");

  // Add site dialog, with a site that is removed again right away.
  await page.getByRole("button", { name: "Add site" }).first().click();
  await page.getByLabel("Name").fill("Docs demo");
  await page.getByLabel("URL").fill("https://docs-demo.example.com");
  await page.getByRole("dialog").getByRole("button", { name: "Add site" }).click();
  await page.getByText("Docs demo is ready").waitFor();
  await shot(page, "add-site");
  const { sites: after } = await api(ctx, "GET", `/api/sites?range=${RANGE}`);
  for (const s of after.filter((s) => s.name === "Docs demo")) await api(ctx, "DELETE", `/api/sites/${s.id}`);
  await page.keyboard.press("Escape");

  await page.goto(`${base}/transactions${q}`);
  await shot(page, "transactions", { maxHeight: 1500 });
  await page.locator("table button.link").first().click();
  await page.getByRole("dialog").waitFor();
  await shot(page, "samples");
  await page.keyboard.press("Escape");

  const tallTabs = { wordpress: 1500, database: 1300, errors: 1100, issues: 1100 };
  for (const tab of ["wordpress", "database", "external", "errors", "issues", "settings"]) {
    await page.goto(`${base}/${tab}${q}`);
    await shot(page, tab, { maxHeight: tallTabs[tab] ?? 0 });
  }
  if (issue) {
    await page.goto(`${base}/issues/${issue.fingerprint}${q}`);
    await shot(page, "issue-detail");
  }
  if (traceId) {
    await page.goto(`${base}/traces/${traceId}${q}`);
    await page.getByLabel("Sort by").selectOption({ label: "Duration" });
    await shot(page, "trace", { maxHeight: 1500 });
    const span = page.locator("ol li button").filter({ hasText: slowHost.host.split(":")[0] }).first();
    await span.click();
    await page.waitForTimeout(300);
    await shot(page, "trace-span");
  }
  await ctx.close();

  // ------------------------------------------------------------------ desktop, dark
  const dark = await newContext(browser, { theme: "dark", storageState });
  const dp = await dark.newPage();
  await dp.goto(`${base}/transactions${q}`);
  await shot(dp, "transactions-dark");
  if (traceId) {
    await dp.goto(`${base}/traces/${traceId}${q}`);
    await dp.getByLabel("Sort by").selectOption({ label: "Duration" });
    await shot(dp, "trace-dark", { maxHeight: 1500 });
  }
  if (issue) {
    await dp.goto(`${base}/issues/${issue.fingerprint}${q}`);
    await shot(dp, "issue-detail-dark");
  }
  await dark.close();

  // ------------------------------------------------------------------ mobile, light and dark
  const mobile = await newContext(browser, { viewport: MOBILE, storageState });
  const mp = await mobile.newPage();
  await mp.goto(`${APP}/${q}`);
  await shot(mp, "sites-mobile");
  await mp.goto(`${base}/transactions${q}`);
  await shot(mp, "transactions-mobile");
  if (traceId) {
    await mp.goto(`${base}/traces/${traceId}${q}`);
    await shot(mp, "trace-mobile");
  }
  await mobile.close();

  const mobileDark = await newContext(browser, { viewport: MOBILE, theme: "dark", storageState });
  const mdp = await mobileDark.newPage();
  await mdp.goto(`${base}/issues${q}`);
  await shot(mdp, "issues-mobile-dark");
  await mobileDark.close();

  // ------------------------------------------------------------------ WordPress admin
  for (const [viewport, name] of [
    [DESKTOP, "wp-settings"],
    [MOBILE, "wp-settings-mobile"],
  ]) {
    const wp = await newContext(browser, { viewport });
    const wpPage = await wp.newPage();
    await wpPage.goto(`${WP}/wp-login.php`);
    await wpPage.locator("#user_login").fill(WP_USER);
    await wpPage.locator("#user_pass").fill(WP_PASSWORD);
    await wpPage.locator("#wp-submit").click();
    await wpPage.waitForURL(/wp-admin/);
    await wpPage.goto(`${WP}/wp-admin/tools.php?page=presstrace`);
    await shot(wpPage, name, { full: true });
    await wp.close();
  }
} finally {
  await browser.close();
}

// Shrink the PNGs to a 256-color palette when Python with Pillow is available.
try {
  execFileSync("python3", [path.join(here, "optimize.py"), OUT], { stdio: "inherit" });
} catch {
  console.log("Skipped PNG optimization (needs python3 with Pillow).");
}
