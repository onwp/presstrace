import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type RowSink } from "../../src/server/app";
import { SiteStore, type SiteRecord, type SiteRepo } from "../../src/server/sites";
import { LoginRateLimiter, SESSION_COOKIE, SECURE_SESSION_COOKIE, sessionKey, signSession } from "../../src/server/auth";
import { createLogger, type Logger } from "../../src/server/log";
import { FailureTracker } from "../../src/server/security";
import { installProcessHandlers } from "../../src/server/process";
import { fastHomeTransaction, payloadOf } from "../fixtures/payload";

class MemoryRepo implements SiteRepo {
  saved: SiteRecord[] = [];
  async loadAll() {
    return this.saved;
  }
  async save(site: SiteRecord) {
    this.saved.push(site);
  }
}

const sink: RowSink = { add: () => "ok" };
const config = {
  adminEmail: "admin@example.com",
  adminPassword: "correct horse battery",
  sessionSecret: "0123456789abcdef".repeat(4),
  publicUrl: "http://localhost:8080",
  trustProxy: false,
  webRoot: "dist/web-missing",
  transactionsTtlDays: 30,
  enableDebugRoutes: false,
  ingestRatePerSite: 0,
  ingestBurstPerSite: 0,
};
const signing = sessionKey(config.sessionSecret, config.adminPassword);

let lines: string[];
let log: Logger;
let sites: SiteStore;
let siteKey: string;

beforeEach(async () => {
  lines = [];
  log = createLogger((line) => lines.push(line));
  sites = new SiteStore(new MemoryRepo());
  siteKey = (await sites.create({ name: "Shop", url: "https://shop.example.com" })).key;
});

const events = () =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.msg === "security event");

const make = (overrides: Partial<typeof config> = {}) =>
  createApp({ config: { ...config, ...overrides }, sites, sink, reports: null, limiter: new LoginRateLimiter(2, 60_000), log });

const login = (app: ReturnType<typeof make>, password: string, base = "http://localhost") =>
  app.request(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: "admin@example.com", password }),
  });

describe("security headers", () => {
  it("sends Permissions-Policy, COOP and CORP, and a page CSP without unsafe-inline", async () => {
    const res = await make().request("/login");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("marks API responses as not cacheable and gives them a deny-all CSP", async () => {
    const res = await make().request("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("session cookie", () => {
  it("uses the __Host- prefix with Secure when PUBLIC_URL is https", async () => {
    const app = make({ publicUrl: "https://apm.example.com" });
    const res = await login(app, config.adminPassword, "https://apm.example.com");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${SECURE_SESSION_COOKIE}=`)).toBe(true);
    expect(SECURE_SESSION_COOKIE).toBe("__Host-pt_session");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    const token = /^[^=]+=([^;]+)/.exec(cookie)![1]!;
    const me = await app.request("https://apm.example.com/api/auth/me", { headers: { cookie: `${SECURE_SESSION_COOKIE}=${token}` } });
    expect(me.status).toBe(200);
    // The unprefixed name is not accepted on https, so a cookie planted without the prefix cannot be used.
    const plain = await app.request("https://apm.example.com/api/auth/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(plain.status).toBe(401);
  });

  it("issues a fresh session id on every sign-in", async () => {
    const app = make();
    const a = (await login(app, config.adminPassword)).headers.get("set-cookie") ?? "";
    const b = (await login(app, config.adminPassword)).headers.get("set-cookie") ?? "";
    expect(a.split(";")[0]).not.toBe(b.split(";")[0]);
  });
});

describe("static files", () => {
  it("answers 404 for a missing file instead of the dashboard page", async () => {
    const dir = mkdtempSync(`${tmpdir()}/pt-web-`);
    writeFileSync(`${dir}/index.html`, "<!doctype html><title>PressTrace</title>");
    const app = make({ webRoot: dir });
    for (const path of ["/assets/missing-abc.js", "/.env", "/../package.json", "/%2e%2e/package.json"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("PressTrace");
    }
    expect((await app.request("/sites/abc/transactions")).status).toBe(200);
  });
});

describe("security event log", () => {
  it("logs sign-in failure, success and sign-out without secrets", async () => {
    const app = make();
    expect((await login(app, "wrong-password-123")).status).toBe(401);
    const ok = await login(app, config.adminPassword);
    const token = /^[^=]+=([^;]+)/.exec(ok.headers.get("set-cookie") ?? "")![1]!;
    await app.request("http://localhost/api/auth/logout", { method: "POST", headers: { origin: "http://localhost", cookie: `${SESSION_COOKIE}=${token}` } });
    expect(events().map((e) => e.event)).toEqual(["login_failure", "login_success", "logout"]);
    expect(events()[0]).toMatchObject({ level: "warn", security: true, ip: expect.any(String) });
    const all = lines.join("");
    for (const secret of [config.adminPassword, "wrong-password-123", token, config.sessionSecret]) expect(all).not.toContain(secret);
  });

  it("logs a lockout once the limit is reached", async () => {
    const app = make();
    await login(app, "bad-1");
    await login(app, "bad-2");
    expect((await login(app, "bad-3")).status).toBe(429);
    expect(events().map((e) => e.event)).toEqual(["login_failure", "login_failure", "login_locked"]);
  });

  it("logs site create, update, rotate and delete with the site id and no key", async () => {
    const app = make();
    const headers = {
      cookie: `${SESSION_COOKIE}=${signSession(signing, config.adminEmail)}`,
      origin: "http://localhost",
      "content-type": "application/json",
    };
    const res = await app.request("http://localhost/api/sites", { method: "POST", headers, body: JSON.stringify({ name: "Blog", url: "https://blog.example.com" }) });
    const { site, key } = (await res.json()) as { site: { id: string }; key: string };
    await app.request(`http://localhost/api/sites/${site.id}`, { method: "PATCH", headers, body: JSON.stringify({ name: "Blog 2", url: "https://blog.example.com" }) });
    const rotated = (await (await app.request(`http://localhost/api/sites/${site.id}/rotate`, { method: "POST", headers })).json()) as { key: string };
    await app.request(`http://localhost/api/sites/${site.id}`, { method: "DELETE", headers });
    expect(events().map((e) => [e.event, e.siteId])).toEqual([
      ["site_create", site.id],
      ["site_update", site.id],
      ["site_key_rotate", site.id],
      ["site_delete", site.id],
    ]);
    const all = lines.join("");
    expect(all).not.toContain(key);
    expect(all).not.toContain(rotated.key);
  });

  it("logs repeated bad site keys once per client and window, without the key", async () => {
    const app = make();
    const bad = `pt_${"1".repeat(40)}`;
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${bad}`, "content-type": "application/json" },
        body: JSON.stringify(payloadOf([fastHomeTransaction()])),
      });
      expect(res.status).toBe(401);
    }
    const ok = await app.request("/api/v1/ping", { headers: { authorization: `Bearer ${siteKey}` } });
    expect(ok.status).toBe(200);
    expect(events().map((e) => e.event)).toEqual(["bad_site_key"]);
    expect(events()[0]).toMatchObject({ level: "warn", ip: expect.any(String) });
    expect(lines.join("")).not.toContain(bad);
  });
});

describe("rejected sessions and cross-origin requests", () => {
  it("logs forged, expired and revoked session cookies once per client and window, without the token", async () => {
    const app = make();
    const forged = signSession(sessionKey("another-secret-0123456789abcdef", config.adminPassword), config.adminEmail);
    const expired = signSession(signing, config.adminEmail, Date.now() - 8 * 24 * 3600 * 1000);
    for (const token of [forged, expired, "garbage"]) {
      expect((await app.request("/api/sites", { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).status).toBe(401);
    }
    // No cookie at all is the normal signed-out state, not an event.
    expect((await app.request("/api/sites")).status).toBe(401);
    expect(events().map((e) => [e.event, e.level])).toEqual([["session_rejected", "warn"]]);
    expect(events()[0]).toMatchObject({ ip: expect.any(String), path: "/api/sites" });
    const all = lines.join("");
    for (const token of [forged, expired]) expect(all).not.toContain(token);
  });

  it("logs the use of a revoked session id", async () => {
    const app = make();
    const ok = await login(app, config.adminPassword);
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0]!;
    await app.request("http://localhost/api/auth/logout", { method: "POST", headers: { origin: "http://localhost", cookie } });
    expect((await app.request("/api/auth/me", { headers: { cookie } })).status).toBe(401);
    expect(events().map((e) => [e.event, e.reason])).toEqual([
      ["login_success", undefined],
      ["logout", undefined],
      ["session_rejected", "revoked"],
    ]);
  });

  it("logs refused cross-origin requests once per client and window, with a trimmed origin", async () => {
    const app = make();
    const evil = `https://evil.example/${"a".repeat(500)}`;
    for (let i = 0; i < 3; i++) {
      const res = await app.request("http://localhost/api/sites", {
        method: "POST",
        headers: { origin: evil, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(403);
    }
    expect(events().map((e) => [e.event, e.level, e.method, e.path])).toEqual([["cross_origin_refused", "warn", "POST", "/api/sites"]]);
    expect(String(events()[0]!.origin).length).toBeLessThanOrEqual(200);
  });
});

describe("FailureTracker", () => {
  it("reports the first failure of a window and the count when the next window starts", () => {
    const t = new FailureTracker(60_000);
    expect(t.record("1.2.3.4", 0)).toEqual({ report: true, count: 1 });
    expect(t.record("1.2.3.4", 1000)).toEqual({ report: false, count: 2 });
    expect(t.record("1.2.3.4", 2000)).toEqual({ report: false, count: 3 });
    expect(t.record("5.6.7.8", 2000)).toEqual({ report: true, count: 1 });
    expect(t.record("1.2.3.4", 61_000)).toEqual({ report: true, count: 1, previous: 3 });
  });
});

describe("process handlers", () => {
  it("logs unhandled rejections and keeps running, and exits on uncaught exceptions", () => {
    const handlers = new Map<string, (arg: unknown) => void>();
    const proc = { on: (ev: string, fn: (arg: unknown) => void) => handlers.set(ev, fn) };
    const exit = vi.fn();
    installProcessHandlers(proc, log, exit);
    handlers.get("unhandledRejection")!(new Error("boom\nsecret line"));
    expect(exit).not.toHaveBeenCalled();
    handlers.get("uncaughtException")!(new TypeError("bad"));
    expect(exit).toHaveBeenCalledWith(1);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.map((p) => [p.level, p.msg, p.reason])).toEqual([
      ["error", "Unhandled promise rejection", "boom"],
      ["error", "Uncaught exception, exiting", "bad"],
    ]);
  });
});
