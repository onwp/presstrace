import { describe, expect, it } from "vitest";
import { ConfigError, insecurePublicUrl, loadConfig, trustProxyExposed } from "../../src/server/config";
import { parseTtlDays } from "../../src/server/migrations";
import { SiteStore, validateSiteInput, SiteInputError, hashKey, keyHint, type SiteRecord } from "../../src/server/sites";

describe("loadConfig", () => {
  const base = { ADMIN_PASSWORD: "plum-river-42-anchor", SESSION_SECRET: "3f9a1c7e5b2d8046f1e9a3c5b7d20486" };

  it("refuses to start without ADMIN_PASSWORD and SESSION_SECRET", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (e) {
      expect((e as Error).message).toContain("ADMIN_PASSWORD is not set");
      expect((e as Error).message).toContain("SESSION_SECRET is not set");
    }
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("refuses short, placeholder and well-known admin passwords", () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: "elevenchars" })).toThrow(/at least 12/);
    for (const weak of ["changeme-please", "password1234", "admin12345678", "CHANGE_ME_NOW_1", "your-password-here", "choose-a-password", "a-long-password"]) {
      expect(() => loadConfig({ ...base, ADMIN_PASSWORD: weak }), weak).toThrow(/ADMIN_PASSWORD/);
    }
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: "aaaaaaaaaaaaaaaa" })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...base, ADMIN_EMAIL: "ops@example.org", ADMIN_PASSWORD: "ops@example.org" })).toThrow(/ADMIN_PASSWORD/);
  });

  it("refuses placeholder and low-entropy session secrets", () => {
    for (const weak of ["a".repeat(32), "changeme".repeat(4), "replace-with-openssl-rand-hex-32-output", "abababababababababababababababab"]) {
      expect(() => loadConfig({ ...base, SESSION_SECRET: weak }), weak).toThrow(/SESSION_SECRET/);
    }
    expect(() => loadConfig({ ...base, SESSION_SECRET: base.ADMIN_PASSWORD.repeat(2) })).toThrow(/SESSION_SECRET/);
  });

  it("reads defaults and retention", () => {
    const cfg = loadConfig({ ...base, TRANSACTIONS_TTL_DAYS: "14", PUBLIC_URL: "https://apm.example.com/" });
    expect(cfg.transactionsTtlDays).toBe(14);
    expect(cfg.spansTtlDays).toBe(7);
    expect(cfg.publicUrl).toBe("https://apm.example.com");
    expect(cfg.port).toBe(8080);
  });

  it("reads ingest, buffer and debug settings", () => {
    const d = loadConfig(base);
    expect(d).toMatchObject({ ingestRatePerSite: 20, ingestBurstPerSite: 100, bufferMaxBytes: 64 * 1024 * 1024, enableDebugRoutes: false });
    const c = loadConfig({ ...base, INGEST_RATE_PER_SITE: "0", BUFFER_MAX_MB: "32", ENABLE_DEBUG_ROUTES: "1" });
    expect(c).toMatchObject({ ingestRatePerSite: 0, bufferMaxBytes: 32 * 1024 * 1024, enableDebugRoutes: true });
    expect(() => loadConfig({ ...base, BUFFER_MAX_MB: "0" })).toThrow(/BUFFER_MAX_MB/);
  });

  it("warns about TRUST_PROXY only when the app is reachable on all interfaces", () => {
    expect(trustProxyExposed(loadConfig({ ...base, TRUST_PROXY: "true", APP_BIND: "0.0.0.0" }))).toBe(true);
    expect(trustProxyExposed(loadConfig({ ...base, TRUST_PROXY: "true", APP_BIND: "127.0.0.1" }))).toBe(false);
    expect(trustProxyExposed(loadConfig({ ...base, TRUST_PROXY: "true" }))).toBe(true);
    expect(trustProxyExposed(loadConfig({ ...base, TRUST_PROXY: "false", APP_BIND: "0.0.0.0" }))).toBe(false);
  });

  it("flags a plain-http PUBLIC_URL unless it points at this machine", () => {
    for (const url of ["http://apm.example.com", "http://10.0.0.5:8080", "http://192.168.1.20"]) expect(insecurePublicUrl(url), url).toBe(true);
    for (const url of ["https://apm.example.com", "http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://wp-apm.localhost"]) {
      expect(insecurePublicUrl(url), url).toBe(false);
    }
  });

  it("validates numbers and URLs", () => {
    expect(() => loadConfig({ ...base, SPANS_TTL_DAYS: "0" })).toThrow(/SPANS_TTL_DAYS/);
    expect(() => loadConfig({ ...base, PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
  });
});

describe("migrations", () => {
  it("parses TTL days from engine_full", () => {
    expect(parseTtlDays("MergeTree PARTITION BY toDate(ts) ORDER BY (site_id, ts) TTL toDateTime(ts) + toIntervalDay(30) SETTINGS")).toBe(30);
    expect(parseTtlDays("MergeTree ORDER BY id")).toBeNull();
  });
});

describe("sites", () => {
  it("validates input and normalizes URLs", () => {
    expect(validateSiteInput({ name: " Shop ", url: "https://shop.example.com/" })).toEqual({ name: "Shop", url: "https://shop.example.com" });
    expect(() => validateSiteInput({ name: "x", url: "ftp://x" })).toThrow(SiteInputError);
    expect(() => validateSiteInput({ name: "x", url: "https://u:p@x.com" })).toThrow(SiteInputError);
    expect(() => validateSiteInput({ name: "", url: "https://x.com" })).toThrow(SiteInputError);
  });

  it("stores only the key hash and a hint", async () => {
    const saved: SiteRecord[] = [];
    const store = new SiteStore({ loadAll: async () => saved, save: async (s) => void saved.push(s) });
    const { site, key } = await store.create({ name: "A", url: "https://a.example" });
    expect(site.keyHash).toBe(hashKey(key));
    expect(JSON.stringify(saved)).not.toContain(key);
    expect(site.keyHint).toBe(keyHint(key));
    expect(store.findByKey(key)?.id).toBe(site.id);
    await store.refresh();
    expect(store.findByKey(key)?.id).toBe(site.id);
    await store.remove(site.id);
    await store.refresh();
    expect(store.findByKey(key)).toBeUndefined();
    expect(saved.at(-1)!.updatedAt).toBeGreaterThan(saved[0]!.updatedAt);
  });

  it("does not let a refresh that started before a rotate or delete undo it", async () => {
    const saved: SiteRecord[] = [];
    let release: (() => void) | null = null;
    let slow = false;
    const store = new SiteStore({
      // A slow refresh returns the snapshot it read when it started.
      loadAll: async () => {
        const snapshot = [...saved];
        if (slow) await new Promise<void>((r) => (release = r));
        return snapshot;
      },
      save: async (s) => void saved.push(s),
    });
    const a = await store.create({ name: "A", url: "https://a.example" });
    const b = await store.create({ name: "B", url: "https://b.example" });

    slow = true;
    const inFlight = store.refresh();
    await new Promise((r) => setTimeout(r, 0));
    const rotated = await store.rotate(a.site.id);
    await store.remove(b.site.id);
    release!();
    await inFlight;

    expect(store.findByKey(a.key)).toBeUndefined();
    expect(store.findByKey(rotated!.key)?.id).toBe(a.site.id);
    expect(store.findByKey(b.key)).toBeUndefined();
    expect(store.get(b.site.id)).toBeUndefined();

    slow = false;
    await store.refresh();
    expect(store.findByKey(rotated!.key)?.id).toBe(a.site.id);
    expect(store.findByKey(b.key)).toBeUndefined();
  });
});

describe("TokenBucketLimiter", () => {
  it("allows the burst, then refills at the rate", async () => {
    const { TokenBucketLimiter } = await import("../../src/server/ratelimit");
    const tb = new TokenBucketLimiter(2, 3);
    expect([tb.take("s", 0), tb.take("s", 0), tb.take("s", 0)]).toEqual([0, 0, 0]);
    expect(tb.take("s", 0)).toBe(1);
    expect(tb.take("s", 500)).toBe(0);
    expect(tb.take("other", 500)).toBe(0);
    expect(new TokenBucketLimiter(0, 0).take("s", 0)).toBe(0);
  });
});
