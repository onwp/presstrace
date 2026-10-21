import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { fastHomeTransaction, payloadOf, productPageTransaction, txnId } from "../fixtures/payload";

/**
 * Browser tests against a running PressTrace (docker compose up). Configure with
 * E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD (the sign-in defaults to ADMIN_EMAIL and ADMIN_PASSWORD from
 * app/.env); set E2E_SCREENSHOT_DIR to save screenshots.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
/** Values from app/.env, the file Compose starts the app with, for settings not given in the environment. */
function dotenv(): Record<string, string> {
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    return Object.fromEntries([...text.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
  } catch {
    return {};
  }
}
const fileEnv = dotenv();
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? fileEnv.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? fileEnv.ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "";
const WIDTHS = [360, 768, 1440];
const SCHEMES = ["light", "dark"] as const;

const siteName = `E2E shop ${randomBytes(3).toString("hex")}`;
let browser: Browser;
let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
let siteId = "";
let siteKey = "";
let slowId = "";
let errorId = "";

/** Waits until the locator is visible (Playwright's own expect is tied to its runner). */
const see = (l: Locator) => l.waitFor({ state: "visible", timeout: 10_000 });

async function count(l: Locator, n: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((await l.count()) === n) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(await l.count()).toBe(n);
}

const ping = (key: string) => fetch(`${BASE}/api/v1/ping`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.status);

async function ingest(key: string, transactions: object[], gzip = false): Promise<number> {
  const body = JSON.stringify(payloadOf(transactions));
  const res = await fetch(`${BASE}/api/v1/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-presstrace-agent": "0.1.0",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
    },
    body: gzip ? gzipSync(body) : body,
  });
  return res.status;
}

async function newPage(width = 1440, scheme: "light" | "dark" = "light"): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, storageState: storage });
  return [ctx, await ctx.newPage()];
}

async function noHorizontalScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

beforeAll(async () => {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/login/);

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await see(page.getByRole("alert"));
    expect(await page.getByRole("alert").innerText()).toContain("incorrect");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`);

  await page.getByRole("button", { name: "Add site" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(siteName);
  await dialog.getByLabel("URL").fill("https://shop.example.com");
  await dialog.getByRole("button", { name: "Add site" }).click();
  await see(dialog.getByRole("heading", { name: `${siteName} is ready` }));
  const snippet = await dialog.locator("pre code").innerText();
  siteKey = /pt_[0-9a-f]{40}/.exec(snippet)![0];
  expect(snippet).toContain(`define( 'PRESSTRACE_APP_URL'`);
  const setupHref = await dialog.getByRole("link", { name: "Open site setup" }).getAttribute("href");
  siteId = /\/sites\/([^/]+)\/settings/.exec(setupHref!)![1]!;
  await dialog.getByRole("button", { name: "Done" }).click();
  storage = await ctx.storageState();
  await ctx.close();

  const now = Date.now();
  slowId = txnId();
  errorId = txnId();
  const fatal = { ...fastHomeTransaction(now - 20_000), id: errorId, status: 500, errors: [
    { level: "fatal", message: "Allowed memory size of 268435456 bytes exhausted", file: "wp-content/plugins/demo/big.php", line: 7, component: "plugin:demo" },
  ] };
  expect(await ingest(siteKey, [productPageTransaction({ id: slowId, ts: now - 60_000, withWarning: true })])).toBe(202);
  expect(await ingest(siteKey, [productPageTransaction({ ts: now - 90_000, externalMs: 700 })], true)).toBe(202);
  expect(await ingest(siteKey, [productPageTransaction({ ts: now - 120_000, externalMs: 300 }), fastHomeTransaction(now - 30_000), fatal])).toBe(202);

  // Wait for the batch writer to flush (it runs every second).
  const [c, p] = await newPage();
  for (let i = 0; i < 30; i++) {
    const data = (await (await p.request.get(`${BASE}/api/sites/${siteId}/transactions?range=1h`)).json()) as { summary: { requests: number } };
    if (data.summary.requests === 5) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await c.close();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const PAGES: { name: string; path: () => string; marker: string }[] = [
  { name: "sites", path: () => "/", marker: siteName },
  { name: "transactions", path: () => `/sites/${siteId}/transactions`, marker: "Slowest transactions" },
  { name: "wordpress", path: () => `/sites/${siteId}/wordpress`, marker: "payment-api-test" },
  { name: "database", path: () => `/sites/${siteId}/database`, marker: "wp_postmeta" },
  { name: "external", path: () => `/sites/${siteId}/external`, marker: "api.stripe.com" },
  { name: "errors", path: () => `/sites/${siteId}/errors`, marker: "Allowed memory size" },
  { name: "issues", path: () => `/sites/${siteId}/issues`, marker: "Possible N+1 query" },
  { name: "setup", path: () => `/sites/${siteId}/settings`, marker: "PRESSTRACE_SITE_KEY" },
  { name: "trace", path: () => `/sites/${siteId}/traces/${slowId}`, marker: "Timeline" },
];

describe("every page in both themes at 360, 768 and 1440 px", () => {
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      it(`${scheme} ${width}px`, async () => {
        const [ctx, page] = await newPage(width, scheme);
        const cspViolations: string[] = [];
        page.on("console", (m) => {
          if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
        });
        try {
          for (const p of PAGES) {
            await page.goto(`${BASE}${p.path()}?range=1h`);
            await see(page.getByText(p.marker).first());
            await page.waitForLoadState("networkidle");
            expect(await noHorizontalScroll(page), `${p.name} has no horizontal scroll`).toBe(0);
            const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
            expect(serious, `${p.name} has no serious or critical WCAG violations`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
            if (p.name !== "sites") {
              if (width < 768) await see(page.getByLabel("Section", { exact: true }));
              else await see(page.getByRole("navigation", { name: "Site sections" }));
            }
            if (SHOTS) await page.screenshot({ path: `${SHOTS}/${p.name}-${scheme}-${width}.png`, fullPage: true });
          }
          expect(cspViolations, "no Content Security Policy violations").toEqual([]);
          if (width < 768) {
            await page.getByRole("button", { name: "Menu" }).click();
            await see(page.locator("#mobile-menu").getByRole("button", { name: "Sign out" }));
          }
        } finally {
          await ctx.close();
        }
      }, 120_000);
    }
  }
});

describe("drill-downs", () => {
  let ctx: BrowserContext;
  let page: Page;
  beforeAll(async () => {
    [ctx, page] = await newPage();
  });
  afterAll(async () => ctx.close());

  it("fleet row shows stats and opens the site", async () => {
    await page.goto(`${BASE}/?range=1h`);
    const row = page.getByRole("row", { name: new RegExp(siteName) });
    await see(row);
    expect(await row.innerText()).toContain("5");
    await see(row);
    expect(await row.innerText()).toContain("high");
    await row.getByRole("link", { name: siteName }).click();
    await page.waitForURL(new RegExp(`/sites/${siteId}/transactions`));
  });

  it("transaction row opens samples, sample opens trace, span opens details", async () => {
    await page.goto(`${BASE}/sites/${siteId}/transactions?range=1h`);
    await see(page.getByText("Overall transaction time"));
    await page.getByRole("button", { name: "single-product" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await see(dialog.getByText("Slowest sample", { exact: true }));
    await see(dialog.getByText("p95 sample", { exact: true }));
    await see(dialog.getByText("p50 sample", { exact: true }));
    await dialog.getByRole("link", { name: /Open trace for the Slowest sample/ }).click();
    await page.waitForURL(new RegExp(`/traces/${slowId}`));

    await see(page.getByText("Where the time went"));
    await see(page.getByText("Over 25%").first());
    await see(page.getByText("Issues found in this request"));
    await see(page.getByText('Undefined array key "foo"'));

    await page.getByRole("button", { name: /api\.stripe\.com POST/ }).click();
    const drawer = page.getByRole("dialog");
    await see(drawer.getByText("External request"));
    await see(drawer.getByText("https://api.stripe.com/v1/charges"));
    await see(drawer.getByText("class-wc-cart.php:1276 do_action"));
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: /wp_options SELECT/ }).first().click();
    await see(page.getByRole("dialog").getByText("Not captured because the query took less than 1 ms."));
    await page.keyboard.press("Escape");

    await page.getByLabel("Kind").selectOption("http");
    await count(page.locator("ol > li"), 1);
    await page.getByLabel("Kind").selectOption("");
    await page.getByLabel("Sort by").selectOption("duration");
    await see(page.locator("ol > li").first());
    expect(await page.locator("ol > li").first().innerText()).toContain("update_card_payment");
  });

  const sampleChecks: { tab: string; button: RegExp | string }[] = [
    { tab: "wordpress", button: /payment-api-test/ },
    { tab: "wordpress", button: "update_card_payment" },
    { tab: "wordpress", button: "woocommerce/woocommerce.php" },
    { tab: "database", button: /^SELECT post_id.*show samples$/ },
    { tab: "external", button: "api.stripe.com" },
    { tab: "errors", button: /Allowed memory size/ },
  ];
  for (const s of sampleChecks) {
    it(`${s.tab}: ${String(s.button)} opens samples with trace links`, async () => {
      await page.goto(`${BASE}/sites/${siteId}/${s.tab}?range=1h`);
      await page.getByRole("button", { name: s.button }).first().click();
      const dialog = page.getByRole("dialog");
      await see(dialog.getByRole("heading", { name: "Recent samples" }));
      const link = dialog.getByRole("table").getByRole("link").first();
      await link.click();
      await page.waitForURL(/\/traces\/[0-9a-f]{32}/);
      await see(page.getByText("Timeline"));
    });
  }

  it("issues filter, paginate and open a detail with fix text and a trace link", async () => {
    await page.goto(`${BASE}/sites/${siteId}/issues?range=1h`);
    await page.getByLabel("Severity").selectOption("high");
    await page.waitForURL(/severity=high/);
    await page.waitForLoadState("networkidle");
    const badges = page.locator("tbody tr td:first-child");
    await see(badges.first());
    expect((await badges.first().innerText()).trim()).toBe("High");
    for (const t of await badges.allInnerTexts()) expect(t).toBe("High");
    await page.getByLabel("Severity").selectOption("");
    await page.getByLabel("Type").selectOption("n_plus_one");
    await page.waitForLoadState("networkidle");
    await see(page.getByText(/^Page 1 of 1,/));
    await page.getByRole("link", { name: "Possible N+1 query" }).click();
    await see(page.getByRole("heading", { name: "What is happening" }));
    await see(page.getByText(/update_meta_cache/));
    await page.getByRole("link", { name: "Open the trace" }).click();
    await page.waitForURL(/\/traces\//);
  });

  it("fatal error shows on the trace and as a high issue", async () => {
    await page.goto(`${BASE}/sites/${siteId}/traces/${errorId}?range=1h`);
    await see(page.getByText("PHP errors in this request"));
    await see(page.getByRole("link", { name: "PHP fatal error" }));
  });

  it("time range lives in the URL and survives tab changes", async () => {
    await page.goto(`${BASE}/sites/${siteId}/transactions?range=1h`);
    await page.getByLabel("Time range").selectOption("24h");
    await page.waitForURL(/range=24h/);
    await page.getByRole("navigation", { name: "Site sections" }).getByRole("link", { name: "Database" }).click();
    await page.waitForURL(new RegExp(`/sites/${siteId}/database\\?range=24h`));
    await page.getByRole("button", { name: "Refresh" }).click();
    await see(page.getByText("wp_postmeta").first());
  });

  it("type filter narrows transactions", async () => {
    await page.goto(`${BASE}/sites/${siteId}/transactions?range=1h&type=rest`);
    await see(page.getByText("No requests in this time range"));
  });

  it("theme toggle switches and persists", async () => {
    await page.goto(`${BASE}/`);
    await page.locator("#theme-desktop").selectOption("dark");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await page.locator("#theme-desktop").selectOption("system");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  });
});

describe("site management and sign out", () => {
  it("empty site explains setup", async () => {
    const [ctx, page] = await newPage(360);
    const res = await page.request.post(`${BASE}/api/sites`, {
      headers: { origin: BASE },
      data: { name: `${siteName} empty`, url: "https://empty.example.com" },
    });
    const { site } = (await res.json()) as { site: { id: string } };
    await page.goto(`${BASE}/sites/${site.id}/transactions`);
    await see(page.getByText("No data from this site yet"));
    await page.getByRole("link", { name: "Open setup instructions" }).click();
    await see(page.getByText("PRESSTRACE_SITE_KEY"));
    expect((await page.request.delete(`${BASE}/api/sites/${site.id}`, { headers: { origin: BASE } })).status()).toBe(200);
    await ctx.close();
  });

  it("edit, rotate key and remove a site from the setup page", async () => {
    const [ctx, page] = await newPage();
    await page.goto(`${BASE}/sites/${siteId}/settings`);
    await page.getByLabel("Name").fill(`${siteName} renamed`);
    await page.getByRole("button", { name: "Save details" }).click();
    await see(page.getByRole("heading", { level: 1, name: `${siteName} renamed` }));

    const oldKey = siteKey;
    expect(await ping(oldKey)).toBe(200);
    await page.getByRole("button", { name: "Rotate site key" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Rotate key" }).click();
    await see(page.getByText("New key created"));
    const newKey = /pt_[0-9a-f]{40}/.exec(await page.locator("pre code").innerText())![0];
    expect(newKey).not.toBe(oldKey);
    expect(await ping(oldKey)).toBe(401);
    expect(await ping(newKey)).toBe(200);

    await page.getByRole("button", { name: "Remove site" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove site" }).click();
    await page.waitForURL(`${BASE}/`);
    await see(page.getByRole("heading", { name: "Sites" }));
    await count(page.getByText(`${siteName} renamed`), 0);
    expect(await ping(newKey)).toBe(401);
    await ctx.close();
  });

  it("sign-in only follows next= to a path on this origin", async () => {
    const browserCtx = await browser.newContext();
    try {
      for (const [next, landed] of [
        ["/\\evil.example/x", `${BASE}/`],
        ["//evil.example/x", `${BASE}/`],
        ["https://evil.example/x", `${BASE}/`],
        [`/sites/${siteId}/issues?range=1h`, `${BASE}/sites/${siteId}/issues?range=1h`],
      ] as const) {
        const page = await browserCtx.newPage();
        await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
        await page.getByLabel("Email").fill(EMAIL);
        await page.getByLabel("Password").fill(PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL(landed);
        expect(new URL(page.url()).origin, next).toBe(new URL(BASE).origin);
        await page.close();
      }
    } finally {
      await browserCtx.close();
    }
  });

  it("sign out ends the session", async () => {
    const [ctx, page] = await newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    expect((await page.request.get(`${BASE}/api/auth/me`)).status()).toBe(401);
    await ctx.close();
  });
});
