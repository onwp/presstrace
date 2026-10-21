import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, decodeBody, bearerKey, PayloadTooLarge, type RowSink } from "../../src/server/app";
import { SiteStore, type SiteRecord, type SiteRepo } from "../../src/server/sites";
import { LoginRateLimiter, SESSION_COOKIE, SessionRevocations, sessionKey, signSession } from "../../src/server/auth";
import type { AddResult } from "../../src/server/batcher";
import { silentLogger } from "../../src/server/log";
import type { Rows } from "../../src/server/transform";
import { fastHomeTransaction, payloadOf, productPageTransaction } from "../fixtures/payload";

class MemoryRepo implements SiteRepo {
  saved: SiteRecord[] = [];
  async loadAll() {
    return this.saved;
  }
  async save(site: SiteRecord) {
    this.saved.push(site);
  }
}

class CaptureSink implements RowSink {
  batches: Rows[] = [];
  state: AddResult = "ok";
  add(rows: Rows): AddResult {
    if (this.state !== "ok") return this.state;
    this.batches.push(rows);
    return "ok";
  }
}

const config = {
  adminEmail: "admin@example.com",
  adminPassword: "admin12345",
  sessionSecret: "s".repeat(40),
  publicUrl: "http://localhost:8080",
  trustProxy: false,
  webRoot: "dist/web-missing",
  transactionsTtlDays: 30,
  enableDebugRoutes: true,
  ingestRatePerSite: 0,
  ingestBurstPerSite: 0,
};
const key0 = sessionKey(config.sessionSecret, config.adminPassword);

let sites: SiteStore;
let sink: CaptureSink;
let key: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  sites = new SiteStore(new MemoryRepo());
  sink = new CaptureSink();
  key = (await sites.create({ name: "Shop", url: "https://shop.example.com" })).key;
  app = createApp({ config, sites, sink, reports: null, limiter: new LoginRateLimiter(3, 60_000), log: silentLogger });
});

const ingest = (body: BodyInit, headers: Record<string, string> = {}) =>
  app.request("/api/v1/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body,
  });

describe("POST /api/v1/ingest", () => {
  it("accepts a plain JSON payload with 202", async () => {
    const res = await ingest(JSON.stringify(payloadOf([productPageTransaction()])));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, accepted: 1 });
    expect(sink.batches[0]!.transactions[0]!.site_id).toBe(sites.list()[0]!.id);
    expect(sink.batches[0]!.issues.length).toBeGreaterThan(0);
  });

  it("accepts a gzip payload", async () => {
    const body = gzipSync(JSON.stringify(payloadOf([fastHomeTransaction()])));
    const res = await ingest(body, { "content-encoding": "gzip" });
    expect(res.status).toBe(202);
    expect(sink.batches).toHaveLength(1);
  });

  it("returns 401 for a missing, malformed or unknown key", async () => {
    const body = JSON.stringify(payloadOf([fastHomeTransaction()]));
    expect((await app.request("/api/v1/ingest", { method: "POST", body })).status).toBe(401);
    expect((await ingest(body, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await ingest(body, { authorization: `Bearer pt_${"0".repeat(40)}` })).status).toBe(401);
  });

  it("returns 400 for invalid JSON, invalid gzip and invalid payloads", async () => {
    expect((await ingest("{not json")).status).toBe(400);
    expect((await ingest(new Uint8Array([0x1f, 0x8b, 1, 2, 3]), { "content-encoding": "gzip" })).status).toBe(400);
    const res = await ingest(JSON.stringify({ v: 1 }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { details: string[] };
    expect(json.details.length).toBeGreaterThan(0);
  });

  it("returns 413 when the decompressed body exceeds 2 MB", async () => {
    const huge = gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x20));
    expect((await ingest(huge, { "content-encoding": "gzip" })).status).toBe(413);
    expect((await ingest("x".repeat(2 * 1024 * 1024 + 10))).status).toBe(413);
  });

  it("returns 413 for a streamed body over 2 MB without Content-Length", async () => {
    const chunk = new Uint8Array(512 * 1024).fill(0x20);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const res = await app.request("/api/v1/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(sink.batches).toHaveLength(0);
  });

  it("returns 429 with Retry-After when the write buffer is full", async () => {
    sink.state = "full";
    const res = await ingest(JSON.stringify(payloadOf([fastHomeTransaction()])));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("returns 503 with Retry-After when ClickHouse is down and the buffer is full", async () => {
    sink.state = "unavailable";
    const res = await ingest(JSON.stringify(payloadOf([fastHomeTransaction()])));
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps in-window transactions and drops ones with timestamps in the future or past retention", async () => {
    const now = Date.now();
    const future = { ...fastHomeTransaction(Date.UTC(2090, 0, 1)) };
    const ancient = { ...fastHomeTransaction(now - 31 * 86_400_000) };
    const fine = fastHomeTransaction(now - 1000);
    const res = await ingest(JSON.stringify(payloadOf([future, fine, ancient])));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, accepted: 1, rejected: 2 });
    expect(sink.batches[0]!.transactions).toHaveLength(1);
    const soon = fastHomeTransaction(now + 30 * 60_000);
    expect((await ingest(JSON.stringify(payloadOf([soon])))).status).toBe(202);
  });

  it("returns 400 when every transaction is outside the accepted time window", async () => {
    const res = await ingest(JSON.stringify(payloadOf([fastHomeTransaction(Date.now() + 2 * 3600_000)])));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/clock/i);
    expect(sink.batches).toHaveLength(0);
  });

  it("rate limits each site with a token bucket and answers 429 with Retry-After", async () => {
    const limited = createApp({ config: { ...config, ingestRatePerSite: 1, ingestBurstPerSite: 2 }, sites, sink, reports: null, log: silentLogger });
    const other = (await sites.create({ name: "Other", url: "https://other.example.com" })).key;
    const send = (k: string) =>
      limited.request("/api/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
        body: JSON.stringify(payloadOf([fastHomeTransaction()])),
      });
    expect((await send(key)).status).toBe(202);
    expect((await send(key)).status).toBe(202);
    const third = await send(key);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // Another site has its own bucket.
    expect((await send(other)).status).toBe(202);
  });

  it("rejects the old key after rotation", async () => {
    const old = key;
    const rotated = await sites.rotate(sites.list()[0]!.id);
    const body = JSON.stringify(payloadOf([fastHomeTransaction()]));
    expect((await ingest(body, { authorization: `Bearer ${old}` })).status).toBe(401);
    expect((await ingest(body, { authorization: `Bearer ${rotated!.key}` })).status).toBe(202);
  });

  it("rejects keys of deleted sites", async () => {
    await sites.remove(sites.list()[0]!.id);
    expect((await ingest(JSON.stringify(payloadOf([fastHomeTransaction()])))).status).toBe(401);
  });
});

describe("GET /api/v1/ping and debug delay", () => {
  it("does not register the debug route unless ENABLE_DEBUG_ROUTES is on", async () => {
    const prod = createApp({ config: { ...config, enableDebugRoutes: false }, sites, sink, reports: null, log: silentLogger });
    const res = await prod.request("/api/v1/debug/delay?ms=1", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(404);
  });

  it("returns the site for a valid key", async () => {
    const res = await app.request("/api/v1/ping", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, site: { name: "Shop" } });
  });

  it("delays and clamps to 5000 ms", async () => {
    const start = Date.now();
    const auth = { headers: { authorization: `Bearer ${key}` } };
    const res = await app.request("/api/v1/debug/delay?ms=60", auth);
    expect(await res.json()).toEqual({ ok: true, ms: 60 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);
    const neg = await app.request("/api/v1/debug/delay?ms=-5", auth);
    expect(await neg.json()).toEqual({ ok: true, ms: 0 });
    expect((await app.request("/api/v1/debug/delay?ms=10")).status).toBe(401);
  });
});

describe("session API", () => {
  const login = (body: unknown, headers: Record<string, string> = { origin: "http://localhost" }) =>
    app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("logs in with the right credentials and sets an HttpOnly cookie", async () => {
    const res = await login({ email: "Admin@Example.com", password: "admin12345" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=604800");
  });

  it("rejects wrong credentials and rate limits", async () => {
    for (let i = 0; i < 3; i++) expect((await login({ email: "admin@example.com", password: "wrong" })).status).toBe(401);
    const blocked = await login({ email: "admin@example.com", password: "admin12345" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("counts parallel failed logins before letting more through", async () => {
    const statuses = (await Promise.all(Array.from({ length: 8 }, () => login({ email: "admin@example.com", password: "wrong" })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("uses the rightmost X-Forwarded-For entry behind a trusted proxy", async () => {
    const proxied = createApp({ config: { ...config, trustProxy: true }, sites, sink, reports: null, limiter: new LoginRateLimiter(1, 60_000), log: silentLogger });
    const attempt = (xff: string) =>
      proxied.request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": xff },
        body: JSON.stringify({ email: "admin@example.com", password: "wrong" }),
      });
    expect((await attempt("1.1.1.1, 10.0.0.5")).status).toBe(401);
    // A spoofed leftmost entry does not give the same client a fresh limit.
    expect((await attempt("2.2.2.2, 10.0.0.5")).status).toBe(429);
  });

  it("refuses cross-origin state changes", async () => {
    expect((await login({ email: "admin@example.com", password: "admin12345" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await login({ email: "admin@example.com", password: "admin12345" }, {})).status).toBe(403);
  });

  it("requires a valid session for dashboard endpoints", async () => {
    expect((await app.request("/api/sites")).status).toBe(401);
    const forged = `${SESSION_COOKIE}=${signSession("other-secret".repeat(4), "admin@example.com")}`;
    expect((await app.request("/api/auth/me", { headers: { cookie: forged } })).status).toBe(401);
    const good = `${SESSION_COOKIE}=${signSession(key0, "admin@example.com")}`;
    const me = await app.request("/api/auth/me", { headers: { cookie: good } });
    expect(me.status).toBe(200);
    // A token signed with the bare SESSION_SECRET, or before the admin password changed, is refused.
    const bare = `${SESSION_COOKIE}=${signSession(config.sessionSecret, "admin@example.com")}`;
    expect((await app.request("/api/auth/me", { headers: { cookie: bare } })).status).toBe(401);
    const oldPassword = `${SESSION_COOKIE}=${signSession(sessionKey(config.sessionSecret, "old-password"), "admin@example.com")}`;
    expect((await app.request("/api/auth/me", { headers: { cookie: oldPassword } })).status).toBe(401);
  });

  it("refuses oversized login and dashboard bodies with 413", async () => {
    const big = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ email: "admin@example.com", password: "x".repeat(20 * 1024) }),
    });
    expect(big.status).toBe(413);
    const cookie = `${SESSION_COOKIE}=${signSession(key0, "admin@example.com")}`;
    const site = await app.request("http://localhost/api/sites", {
      method: "POST",
      headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(70 * 1024), url: "https://x.example.com" }),
    });
    expect(site.status).toBe(413);
  });

  it("caps failed logins across all clients", async () => {
    const shared = createApp({ config: { ...config, trustProxy: true }, sites, sink, reports: null, limiter: new LoginRateLimiter(5, 60_000, 4), log: silentLogger });
    const attempt = (ip: string, password = "wrong") =>
      shared.request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "admin@example.com", password }),
      });
    expect((await attempt("10.0.0.50", "admin12345")).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await attempt(`10.0.0.${i}`)).status).toBe(401);
    expect((await attempt("10.0.0.99", "admin12345")).status).toBe(429);
    // The address the admin signed in from before is not locked out by other clients' failures.
    expect((await attempt("10.0.0.50", "admin12345")).status).toBe(200);
  });

  it("creates, rotates and deletes sites", async () => {
    const cookie = `${SESSION_COOKIE}=${signSession(key0, "admin@example.com")}`;
    const headers = { cookie, origin: "http://localhost", "content-type": "application/json" };
    const bad = await app.request("http://localhost/api/sites", { method: "POST", headers, body: JSON.stringify({ name: "", url: "x" }) });
    expect(bad.status).toBe(400);
    const res = await app.request("http://localhost/api/sites", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Blog", url: "https://blog.example.com/" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { site: { id: string; url: string }; key: string };
    expect(created.key).toMatch(/^pt_[0-9a-f]{40}$/);
    expect(created.site.url).toBe("https://blog.example.com");
    const rot = await app.request(`http://localhost/api/sites/${created.site.id}/rotate`, { method: "POST", headers });
    expect(((await rot.json()) as { key: string }).key).not.toBe(created.key);
    const del = await app.request(`http://localhost/api/sites/${created.site.id}`, { method: "DELETE", headers });
    expect(del.status).toBe(200);
    expect(sites.get(created.site.id)).toBeUndefined();
    const missing = await app.request(`http://localhost/api/sites/${created.site.id}/rotate`, { method: "POST", headers });
    expect(missing.status).toBe(404);
  });
});

describe("site details, logout and routing", () => {
  const cookie = () => `${SESSION_COOKIE}=${signSession(key0, "admin@example.com")}`;
  const json = { origin: "http://localhost", "content-type": "application/json" };

  it("updates a site name and URL", async () => {
    const id = sites.list()[0]!.id;
    const res = await app.request(`http://localhost/api/sites/${id}`, {
      method: "PATCH",
      headers: { ...json, cookie: cookie() },
      body: JSON.stringify({ name: "Shop renamed", url: "https://shop2.example.com/" }),
    });
    expect(res.status).toBe(200);
    expect(sites.get(id)).toMatchObject({ name: "Shop renamed", url: "https://shop2.example.com" });
    const bad = await app.request(`http://localhost/api/sites/${id}`, {
      method: "PATCH",
      headers: { ...json, cookie: cookie() },
      body: JSON.stringify({ name: "x", url: "nope" }),
    });
    expect(bad.status).toBe(400);
  });

  it("logs out by clearing the cookie and revoking the token", async () => {
    const revocations = new SessionRevocations();
    const appR = createApp({ config, sites, sink, reports: null, revocations, log: silentLogger });
    const c = cookie();
    expect((await appR.request("/api/auth/me", { headers: { cookie: c } })).status).toBe(200);
    const res = await appR.request("http://localhost/api/auth/logout", { method: "POST", headers: { ...json, cookie: c } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    // A copy of the old cookie no longer works.
    expect((await appR.request("/api/auth/me", { headers: { cookie: c } })).status).toBe(401);
    // Other sessions stay valid.
    expect((await appR.request("/api/auth/me", { headers: { cookie: cookie() } })).status).toBe(200);
  });

  it("ignores fields other than name and URL on update (no mass assignment)", async () => {
    const before = sites.list()[0]!;
    const res = await app.request(`http://localhost/api/sites/${before.id}`, {
      method: "PATCH",
      headers: { ...json, cookie: cookie() },
      body: JSON.stringify({
        name: "Shop",
        url: "https://shop.example.com",
        id: "other-id",
        keyHash: "0".repeat(64),
        keyHint: "pt_owned...0000",
        deleted: true,
        createdAt: 1,
        __proto__: { deleted: true },
      }),
    });
    expect(res.status).toBe(200);
    const after = sites.get(before.id)!;
    expect(after).toMatchObject({ id: before.id, keyHash: before.keyHash, keyHint: before.keyHint, deleted: false, createdAt: before.createdAt });
    expect(sites.get("other-id")).toBeUndefined();
    expect(sites.findByKey(key)?.id).toBe(before.id);
  });

  it("makes every dashboard route of a deleted site answer 404 and its key stop working", async () => {
    const id = sites.list()[0]!.id;
    const h = { ...json, cookie: cookie() };
    expect((await app.request(`http://localhost/api/sites/${id}`, { method: "DELETE", headers: h })).status).toBe(200);
    const routes: [string, string][] = [
      ["GET", ""],
      ["PATCH", ""],
      ["DELETE", ""],
      ["POST", "/rotate"],
      ["GET", "/transactions"],
      ["GET", "/wordpress"],
      ["GET", "/database"],
      ["GET", "/external"],
      ["GET", "/errors"],
      ["GET", "/issues"],
      ["GET", "/issues/abc"],
      ["GET", "/samples?by=transaction&key=x"],
      ["GET", `/traces/${"a".repeat(32)}`],
    ];
    for (const [method, suffix] of routes) {
      const res = await app.request(`http://localhost/api/sites/${id}${suffix}`, {
        method,
        headers: h,
        body: method === "PATCH" ? JSON.stringify({ name: "Back", url: "https://x.example.com" }) : undefined,
      });
      expect(res.status, `${method} ${suffix}`).toBe(404);
      expect(await res.json()).toEqual({ error: "Site not found" });
    }
    expect((await app.request("/api/v1/ping", { headers: { authorization: `Bearer ${key}` } })).status).toBe(401);
    expect((await ingest(JSON.stringify(payloadOf([fastHomeTransaction()])))).status).toBe(401);
  });

  it("answers every API error as JSON with an error message and no internals", async () => {
    const failing = createApp({
      config,
      sites,
      sink,
      reports: {
        fleet: () => Promise.reject(new Error("ClickHouse at /var/lib/clickhouse failed: SELECT * FROM sites")),
      } as never,
      log: silentLogger,
    });
    const id = sites.list()[0]!.id;
    const h = { cookie: cookie() };
    const cases: [string, RequestInit, number][] = [
      ["/api/sites", {}, 401],
      [`/api/sites/${id}`, { method: "PATCH", headers: { cookie: cookie(), origin: "https://evil.example" } }, 403],
      ["/api/nothing", { headers: h }, 404],
      [`/api/sites/${id}`, { method: "PUT", headers: { ...json, cookie: cookie() } }, 404],
      [`/api/sites/${id}/traces/zz`, { headers: h }, 400],
      ["/api/v1/ingest", { method: "POST" }, 401],
      ["/api/sites", { headers: h }, 500],
    ];
    for (const [path, init, status] of cases) {
      const res = await failing.request(`http://localhost${path}`, init);
      expect(res.status, path).toBe(status);
      expect(res.headers.get("content-type"), path).toContain("application/json");
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body), path).toEqual(["error"]);
      expect(String(body.error), path).not.toMatch(/clickhouse|SELECT|\/var\/|at \w+ \(/i);
    }
  });

  it("returns 404 for unknown sites and API routes, 400 for bad sample and trace params", async () => {
    const h = { headers: { cookie: cookie() } };
    expect((await app.request("/api/sites/nope/transactions", h)).status).toBe(404);
    expect((await app.request("/api/nothing-here", h)).status).toBe(404);
    const id = sites.list()[0]!.id;
    expect((await app.request(`/api/sites/${id}/samples?by=bogus&key=x`, h)).status).toBe(400);
    expect((await app.request(`/api/sites/${id}/traces/not-hex`, h)).status).toBe(400);
  });

  it("serves the SPA index for / and app routes, not a download", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/pt-web-`);
    writeFileSync(`${dir}/index.html`, "<!doctype html><title>PressTrace</title>");
    writeFileSync(`${dir}/theme.js`, "1");
    const spa = createApp({ config: { ...config, webRoot: dir }, sites, sink, reports: null, log: silentLogger });
    for (const path of ["/", "/sites/abc/transactions", "/login"]) {
      const res = await spa.request(path);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(await res.text()).toContain("PressTrace");
    }
    const js = await spa.request("/theme.js");
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  it("sets security headers", async () => {
    const res = await app.request("/healthz");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    const https = createApp({ config: { ...config, publicUrl: "https://apm.example.com" }, sites, sink, reports: null, log: silentLogger });
    expect((await https.request("/healthz")).headers.get("strict-transport-security")).toBe("max-age=31536000");
  });
});

describe("decodeBody and bearerKey", () => {
  it("detects gzip by magic bytes without a header", () => {
    expect(decodeBody(gzipSync("{}"), undefined)).toBe("{}");
  });
  it("rejects unknown encodings", () => {
    expect(() => decodeBody(new Uint8Array([1]), "br")).toThrow(SyntaxError);
  });
  it("throws PayloadTooLarge on oversize plain bodies", () => {
    expect(() => decodeBody(new Uint8Array(2 * 1024 * 1024 + 1), undefined)).toThrow(PayloadTooLarge);
  });
  it("parses bearer headers", () => {
    expect(bearerKey("Bearer abc")).toBe("abc");
    expect(bearerKey("bearer  abc ")).toBe("abc");
    expect(bearerKey("Basic abc")).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });
});
