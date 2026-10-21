import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@clickhouse/client";
import { connect, queryRows, waitForClickHouse, type CH } from "../../src/server/db";
import { migrate, parseTtlDays } from "../../src/server/migrations";
import { SiteStore, clickhouseSiteRepo } from "../../src/server/sites";
import { Batcher, clickhouseInserter } from "../../src/server/batcher";
import { Reports } from "../../src/server/reports";
import { createApp } from "../../src/server/app";
import { SESSION_COOKIE, SessionRevocations, clickhouseRevocationRepo, sessionKey, signSession } from "../../src/server/auth";
import { silentLogger } from "../../src/server/log";
import type {
  DatabaseResponse,
  IssueDetail,
  IssuesResponse,
  SamplesResponse,
  SiteSummary,
  Trace,
  TransactionsResponse,
  WordPressResponse,
} from "../../src/shared/types";
import { chTimestamp } from "../../src/server/transform";
import { fastHomeTransaction, payloadOf, productPageTransaction } from "../fixtures/payload";

/**
 * Runs against a real ClickHouse. Start one with:
 *   docker compose -f docker-compose.test.yml up -d --wait
 */
const chConfig = {
  url: process.env.CLICKHOUSE_TEST_URL ?? "http://localhost:18123",
  username: process.env.CLICKHOUSE_TEST_USER ?? "test",
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? "test",
  database: `pt_it_${randomBytes(4).toString("hex")}`,
};

const config = {
  adminEmail: "admin@example.com",
  adminPassword: "admin12345",
  sessionSecret: "k".repeat(40),
  publicUrl: "http://localhost",
  trustProxy: false,
  webRoot: "dist/web",
  transactionsTtlDays: 30,
  enableDebugRoutes: false,
  ingestRatePerSite: 0,
  ingestBurstPerSite: 100,
};

let ch: CH;
let sites: SiteStore;
let batcher: Batcher;
let app: ReturnType<typeof createApp>;
let siteId: string;
let siteKey: string;
const cookie = `${SESSION_COOKIE}=${signSession(sessionKey(config.sessionSecret, config.adminPassword), config.adminEmail)}`;
const slowId = randomBytes(16).toString("hex");

const get = async <T>(path: string): Promise<T> => {
  const res = await app.request(`http://localhost${path}`, { headers: { cookie } });
  expect(res.status, `${path} -> ${res.status}`).toBe(200);
  return (await res.json()) as T;
};

beforeAll(async () => {
  await waitForClickHouse(chConfig, 30, 1000);
  ch = await connect(chConfig);
  await migrate(ch, { transactionsTtlDays: 30, spansTtlDays: 7 });
  sites = new SiteStore(clickhouseSiteRepo(ch));
  await sites.refresh();
  batcher = new Batcher(clickhouseInserter(ch), { log: silentLogger });
  app = createApp({
    config,
    sites,
    sink: batcher,
    reports: new Reports(ch),
    health: async () => (await ch.ping()).success,
    revocations: new SessionRevocations(clickhouseRevocationRepo(ch)),
    log: silentLogger,
  });
  const created = await sites.create({ name: "Integration shop", url: "https://shop.example.com" });
  siteId = created.site.id;
  siteKey = created.key;
});

afterAll(async () => {
  if (ch) {
    await ch.command({ query: `DROP DATABASE IF EXISTS ${chConfig.database}` });
    await ch.close();
  }
});

describe("migrations", () => {
  it("are idempotent and versioned", async () => {
    const again = await migrate(ch, { transactionsTtlDays: 30, spansTtlDays: 7 });
    expect(again).toEqual([]);
    const rows = await queryRows<{ version: number }>(ch, "SELECT version FROM schema_migrations");
    expect(rows.map((r) => Number(r.version)).sort()).toEqual([1, 2]);
    const settings = await queryRows<{ engine_full: string }>(
      ch,
      "SELECT engine_full FROM system.tables WHERE database = currentDatabase() AND name = 'spans'",
    );
    expect(settings[0]!.engine_full).toContain("materialize_ttl_recalculate_only = 1");
  });

  it("apply retention changes with MODIFY TTL", async () => {
    await migrate(ch, { transactionsTtlDays: 14, spansTtlDays: 3 });
    const rows = await queryRows<{ name: string; engine_full: string }>(
      ch,
      "SELECT name, engine_full FROM system.tables WHERE database = currentDatabase()",
    );
    const ttl = Object.fromEntries(rows.map((r) => [r.name, parseTtlDays(r.engine_full)]));
    expect(ttl).toMatchObject({ transactions: 14, issue_events: 14, errors: 14, spans: 3, sites: null });
    await migrate(ch, { transactionsTtlDays: 30, spansTtlDays: 7 });
  });
});

describe("sites in ClickHouse", () => {
  it("persist across a cache reload, and soft delete hides them", async () => {
    const fresh = new SiteStore(clickhouseSiteRepo(ch));
    await fresh.refresh();
    expect(fresh.findByKey(siteKey)?.id).toBe(siteId);
    const temp = await sites.create({ name: "Temp", url: "https://temp.example.com" });
    const rotated = await sites.rotate(temp.site.id);
    await sites.remove(temp.site.id);
    await fresh.refresh();
    expect(fresh.get(temp.site.id)).toBeUndefined();
    expect(fresh.findByKey(rotated!.key)).toBeUndefined();
    const raw = await queryRows<{ n: number }>(ch, "SELECT count() AS n FROM sites FINAL WHERE id = {id:String} AND deleted = 1", {
      id: temp.site.id,
    });
    expect(Number(raw[0]!.n)).toBe(1);
  });
});

describe("ingest to dashboard", () => {
  beforeAll(async () => {
    const now = Date.now();
    const transactions = [
      productPageTransaction({ id: slowId, ts: now - 60_000, withWarning: true }),
      productPageTransaction({ ts: now - 120_000, externalMs: 800 }),
      productPageTransaction({ ts: now - 180_000, externalMs: 300, metaLoops: 3 }),
      fastHomeTransaction(now - 30_000),
      fastHomeTransaction(now - 90_000),
    ];
    const plain = await app.request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${siteKey}`, "content-type": "application/json" },
      body: JSON.stringify(payloadOf(transactions.slice(0, 3))),
    });
    expect(plain.status).toBe(202);
    const gz = await app.request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${siteKey}`, "content-type": "application/json", "content-encoding": "gzip" },
      body: gzipSync(JSON.stringify(payloadOf(transactions.slice(3)))),
    });
    expect(gz.status).toBe(202);
    await batcher.flush();
  });

  it("stores rows in every table", async () => {
    const counts = await queryRows<{ t: string; n: number }>(
      ch,
      `SELECT 'transactions' AS t, count() AS n FROM transactions UNION ALL
       SELECT 'spans', count() FROM spans UNION ALL
       SELECT 'errors', count() FROM errors UNION ALL
       SELECT 'issues', count() FROM issue_events`,
    );
    const by = Object.fromEntries(counts.map((r) => [r.t, Number(r.n)]));
    expect(by.transactions).toBe(5);
    expect(by.spans).toBeGreaterThan(40);
    expect(by.errors).toBe(1);
    expect(by.issues).toBeGreaterThan(5);
  });

  it("fleet overview", async () => {
    const { sites: list } = await get<{ sites: SiteSummary[] }>("/api/sites?range=1h");
    const s = list.find((x) => x.id === siteId)!;
    expect(s.requests).toBe(5);
    expect(s.p95).toBeGreaterThan(s.p50);
    expect(s.lastSeen).toBeGreaterThan(Date.now() - 10 * 60_000);
    expect(s.issues.high + s.issues.medium + s.issues.low).toBeGreaterThan(0);
    expect(s.spark.some((v) => v > 0)).toBe(true);
  });

  it("transactions summary, series and table", async () => {
    const t = await get<TransactionsResponse>(`/api/sites/${siteId}/transactions?range=1h`);
    expect(t.summary.requests).toBe(5);
    expect(t.summary.avgQueries).toBeGreaterThan(0);
    expect(t.series.reduce((n, b) => n + b.requests, 0)).toBe(5);
    const product = t.rows.find((r) => r.name === "single-product")!;
    expect(product.count).toBe(3);
    expect(product.share).toBeGreaterThan(90);
    expect(product.max).toBeGreaterThan(product.p50);
    const rest = await get<TransactionsResponse>(`/api/sites/${siteId}/transactions?range=1h&type=rest`);
    expect(rest.summary.requests).toBe(0);
  });

  it("wordpress components, callbacks and load times", async () => {
    const wp = await get<WordPressResponse>(`/api/sites/${siteId}/wordpress?range=1h`);
    expect(wp.components[0]!.component).toBe("plugin:payment-api-test");
    expect(wp.callbacks.some((c) => c.hook === "action:woocommerce_add_to_cart")).toBe(true);
    expect(wp.loads.some((l) => l.kind === "theme_load" && l.name === "storefront")).toBe(true);
  });

  it("database queries by fingerprint and component", async () => {
    const db = await get<DatabaseResponse>(`/api/sites/${siteId}/database?range=1h`);
    const meta = db.queries.find((q) => q.fingerprint.includes("wp_postmeta"))!;
    expect(meta.count).toBe(12 + 12 + 3);
    expect(meta.hash).toMatch(/^\d+$/);
    expect(db.components.some((c) => c.component === "plugin:woocommerce")).toBe(true);
    const samples = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=query&key=${meta.hash}`);
    expect(samples.recent).toHaveLength(3);
    expect(samples.highlights.map((h) => h.label)).toEqual(["Slowest", "p95", "p50"]);
  });

  it("external hosts", async () => {
    const ext = await get<{ rows: { host: string; method: string; count: number }[] }>(`/api/sites/${siteId}/external?range=1h`);
    expect(ext.rows[0]).toMatchObject({ host: "api.stripe.com", method: "POST", count: 3 });
    const s = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=external&key=${encodeURIComponent("POST api.stripe.com")}`);
    expect(s.highlights[0]!.sample.transactionId).toBe(slowId);
  });

  it("errors grouped", async () => {
    const e = await get<{ rows: { fingerprint: string; count: number; component: string }[] }>(`/api/sites/${siteId}/errors?range=1h`);
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0]!.component).toBe("plugin:demo");
    const s = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=error&key=${e.rows[0]!.fingerprint}`);
    expect(s.recent[0]!.transactionId).toBe(slowId);
  });

  it("issues list, filters, pagination and detail", async () => {
    const all = await get<IssuesResponse>(`/api/sites/${siteId}/issues?range=1h`);
    expect(all.total).toBeGreaterThan(5);
    expect(all.routes).toContain("single-product");
    expect(all.issues[0]!.severity).toBe("high");
    const high = await get<IssuesResponse>(`/api/sites/${siteId}/issues?range=1h&severity=high`);
    expect(high.issues.every((i) => i.severity === "high")).toBe(true);
    const nplus = await get<IssuesResponse>(`/api/sites/${siteId}/issues?range=1h&type=n_plus_one`);
    expect(nplus.issues).toHaveLength(1);
    expect(nplus.issues[0]!.count).toBe(2);
    const page2 = await get<IssuesResponse>(`/api/sites/${siteId}/issues?range=1h&page=2`);
    expect(page2.page).toBe(2);
    const detail = await get<IssueDetail>(`/api/sites/${siteId}/issues/${nplus.issues[0]!.fingerprint}?range=1h`);
    expect(detail.fix).toContain("update_meta_cache");
    expect(detail.detail).toContain("N+1");
    expect(detail.sample?.transactionId).toMatch(/^[0-9a-f]{32}$/);
    expect(detail.recent).toHaveLength(2);
    const missing = await app.request(`http://localhost/api/sites/${siteId}/issues/doesnotexist`, { headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it("transaction, component and callback samples", async () => {
    const s = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=transaction&key=single-product`);
    expect(s.highlights[0]).toMatchObject({ label: "Slowest", sample: { transactionId: slowId } });
    expect(s.recent).toHaveLength(3);
    const c = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=component&key=plugin:woocommerce`);
    expect(c.recent).toHaveLength(3);
    const key = encodeURIComponent(JSON.stringify(["update_card_payment", "action:woocommerce_add_to_cart", "plugin:payment-api-test"]));
    const cb = await get<SamplesResponse>(`/api/sites/${siteId}/samples?range=1h&by=callback&key=${key}`);
    expect(cb.recent).toHaveLength(3);
  });

  it("trace with spans, errors and issues", async () => {
    const t = await get<Trace>(`/api/sites/${siteId}/traces/${slowId}`);
    expect(t.name).toBe("single-product");
    expect(t.spans.length).toBe(23);
    expect(t.spans[0]!.start).toBeLessThanOrEqual(t.spans[1]!.start);
    const http = t.spans.find((s) => s.kind === "http")!;
    expect(http.stack.length).toBe(2);
    expect(t.errors[0]!.level).toBe("warning");
    expect(t.issues.some((i) => i.type === "slow_external")).toBe(true);
    expect(t.phpVersion).toBe("8.3.12");
    const missing = await app.request(`http://localhost/api/sites/${siteId}/traces/${"0".repeat(32)}`, { headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it("keeps each site's data behind its own id (no cross-site reads)", async () => {
    const other = await sites.create({ name: "Integration other", url: "https://other.example.com" });
    const otherId = other.site.id;
    const h = { headers: { cookie } };
    // The trace, its samples and its issues exist for siteId, but none of it is reachable through another site id.
    expect((await app.request(`http://localhost/api/sites/${siteId}/traces/${slowId}`, h)).status).toBe(200);
    const cross = await app.request(`http://localhost/api/sites/${otherId}/traces/${slowId}`, h);
    expect(cross.status).toBe(404);
    const samples = await get<SamplesResponse>(`/api/sites/${otherId}/samples?range=1h&by=transaction&key=single-product`);
    expect(samples.recent).toHaveLength(0);
    const tx = await get<{ summary: { requests: number } }>(`/api/sites/${otherId}/transactions?range=1h`);
    expect(tx.summary.requests).toBe(0);
    const issues = await get<{ total: number }>(`/api/sites/${otherId}/issues?range=1h`);
    expect(issues.total).toBe(0);
    // The other site's key cannot write into, or name, the first site.
    const ping = await app.request("http://localhost/api/v1/ping", { headers: { authorization: `Bearer ${other.key}` } });
    expect(((await ping.json()) as { site: { id: string } }).site.id).toBe(otherId);
    // Once deleted, the site's data is unreachable even though its rows stay until retention removes them.
    const otherTid = randomBytes(16).toString("hex");
    const sent = await app.request("http://localhost/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${other.key}`, "content-type": "application/json" },
      body: JSON.stringify(payloadOf([{ ...fastHomeTransaction(Date.now() - 10_000), id: otherTid }])),
    });
    expect(sent.status).toBe(202);
    await batcher.flush();
    expect((await app.request(`http://localhost/api/sites/${otherId}/traces/${otherTid}`, h)).status).toBe(200);
    expect((await app.request(`http://localhost/api/sites/${siteId}/traces/${otherTid}`, h)).status).toBe(404);
    await sites.remove(otherId);
    expect((await app.request(`http://localhost/api/sites/${otherId}/traces/${otherTid}`, h)).status).toBe(404);
    expect((await app.request(`http://localhost/api/sites/${otherId}/transactions?range=1h`, h)).status).toBe(404);
  });

  it("health check reports ClickHouse status", async () => {
    const res = await app.request("http://localhost/healthz");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("batching", () => {
  it("many small payloads become few parts", async () => {
    const before = await queryRows<{ n: number }>(
      ch,
      "SELECT count() AS n FROM system.parts WHERE database = currentDatabase() AND table = 'transactions' AND active",
    );
    for (let i = 0; i < 40; i++) {
      const res = await app.request("http://localhost/api/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${siteKey}`, "content-type": "application/json" },
        body: JSON.stringify(payloadOf([fastHomeTransaction(Date.now() - 1000)])),
      });
      expect(res.status).toBe(202);
    }
    await batcher.flush();
    const after = await queryRows<{ n: number }>(
      ch,
      "SELECT count() AS n FROM system.parts WHERE database = currentDatabase() AND table = 'transactions' AND active",
    );
    expect(Number(after[0]!.n) - Number(before[0]!.n)).toBeLessThanOrEqual(1);
  });
});

describe("hardening", () => {
  it("a batch that spans many daily partitions is still written", async () => {
    const insert = clickhouseInserter(ch);
    const now = Date.now();
    const lines = Array.from({ length: 150 }, (_, i) =>
      JSON.stringify({ site_id: "partition-test", id: randomBytes(16).toString("hex"), ts: chTimestamp(now - i * 86_400_000 + 3_600_000), name: "x" }),
    );
    await insert("transactions", lines, randomBytes(16).toString("hex"));
    const [row] = await queryRows<{ n: number }>(ch, "SELECT count() AS n FROM transactions WHERE site_id = 'partition-test'");
    expect(Number(row!.n)).toBeGreaterThan(0);
  });

  it("stores a retried batch once when the first attempt went through", async () => {
    const insert = clickhouseInserter(ch);
    const line = JSON.stringify({ site_id: "dedup-test", id: randomBytes(16).toString("hex"), ts: chTimestamp(Date.now()), name: "x" });
    const token = randomBytes(16).toString("hex");
    await insert("transactions", [line], token);
    await insert("transactions", [line], token);
    await insert("transactions", [line], randomBytes(16).toString("hex"));
    const [row] = await queryRows<{ n: number }>(ch, "SELECT count() AS n FROM transactions WHERE site_id = 'dedup-test'");
    expect(Number(row!.n)).toBe(2);
  });

  it("fills query_fingerprints through the materialized view", async () => {
    const rows = await queryRows<{ fingerprint: string }>(
      ch,
      "SELECT fingerprint FROM query_fingerprints WHERE site_id = {site:String}",
      { site: siteId },
    );
    expect(rows.some((r) => r.fingerprint.includes("wp_postmeta"))).toBe(true);
  });

  it("keeps revoked session ids across a restart", async () => {
    const first = new SessionRevocations(clickhouseRevocationRepo(ch));
    await first.revoke("integration-sid", Date.now() + 3600_000);
    const second = new SessionRevocations(clickhouseRevocationRepo(ch));
    await second.load();
    expect(second.isRevoked("integration-sid")).toBe(true);
    expect(second.isRevoked("other-sid")).toBe(false);
  });
});

describe("client", () => {
  it("connect() creates the database", async () => {
    const admin = createClient({ url: chConfig.url, username: chConfig.username, password: chConfig.password });
    const rows = await (await admin.query({ query: "SHOW DATABASES", format: "JSONEachRow" })).json<{ name: string }>();
    expect(rows.map((r) => r.name)).toContain(chConfig.database);
    await admin.close();
  });
});
