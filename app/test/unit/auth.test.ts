import { describe, expect, it } from "vitest";
import {
  LoginRateLimiter,
  SESSION_TTL_MS,
  SessionRevocations,
  clientKey,
  sessionKey,
  checkCredentials,
  isSameOrigin,
  safeEqual,
  signSession,
  verifySession,
} from "../../src/server/auth";

const secret = "x".repeat(32);

describe("sessions", () => {
  it("round-trips a signed session", () => {
    expect(verifySession(secret, signSession(secret, "a@b.c"))?.email).toBe("a@b.c");
  });

  it("rejects tampered bodies and signatures", () => {
    const token = signSession(secret, "a@b.c");
    const [body, sig] = token.split(".");
    const otherBody = Buffer.from(JSON.stringify({ e: "evil@b.c", exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifySession(secret, `${otherBody}.${sig}`)).toBeNull();
    expect(verifySession(secret, `${body}.AAAA`)).toBeNull();
    expect(verifySession(secret, `${body}`)).toBeNull();
    expect(verifySession(secret, "")).toBeNull();
    expect(verifySession(secret, undefined)).toBeNull();
    expect(verifySession("y".repeat(32), token)).toBeNull();
  });

  it("expires after 7 days", () => {
    const now = 1_000_000;
    const token = signSession(secret, "a@b.c", now);
    expect(verifySession(secret, token, now + SESSION_TTL_MS - 1)?.email).toBe("a@b.c");
    expect(verifySession(secret, token, now + SESSION_TTL_MS)).toBeNull();
  });
});

describe("credentials", () => {
  const expected = { email: "admin@example.com", password: "pw-123456" };
  it("matches case-insensitive email and exact password", () => {
    expect(checkCredentials(expected, " ADMIN@example.com ", "pw-123456")).toBe(true);
    expect(checkCredentials(expected, "admin@example.com", "pw-1234567")).toBe(false);
    expect(checkCredentials(expected, "other@example.com", "pw-123456")).toBe(false);
    expect(checkCredentials(expected, 1, null)).toBe(false);
  });
  it("safeEqual compares strings of different lengths", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});

describe("LoginRateLimiter", () => {
  it("blocks after the limit and resets after the window", () => {
    const rl = new LoginRateLimiter(2, 1000);
    expect(rl.retryAfter("ip", 0)).toBe(0);
    rl.fail("ip", 0);
    expect(rl.retryAfter("ip", 0)).toBe(0);
    rl.fail("ip", 10);
    expect(rl.retryAfter("ip", 10)).toBe(1);
    expect(rl.retryAfter("other", 10)).toBe(0);
    expect(rl.retryAfter("ip", 1001)).toBe(0);
  });
  it("clears on success", () => {
    const rl = new LoginRateLimiter(1, 1000);
    rl.fail("ip", 0);
    rl.succeed("ip");
    expect(rl.retryAfter("ip", 0)).toBe(0);
  });
});

describe("isSameOrigin", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("accepts the request origin and the public URL", () => {
    expect(isSameOrigin(h({ origin: "http://localhost:8080" }), "http://localhost:8080/api/x", "https://apm.example.com")).toBe(true);
    expect(isSameOrigin(h({ origin: "https://apm.example.com" }), "http://10.0.0.1:8080/api/x", "https://apm.example.com")).toBe(true);
  });
  it("rejects other origins and missing evidence", () => {
    expect(isSameOrigin(h({ origin: "https://evil.example" }), "http://localhost:8080/", "http://localhost:8080")).toBe(false);
    expect(isSameOrigin(h({}), "http://localhost:8080/", "http://localhost:8080")).toBe(false);
    expect(isSameOrigin(h({ "sec-fetch-site": "cross-site" }), "http://localhost:8080/", "http://localhost:8080")).toBe(false);
  });
  it("falls back to Sec-Fetch-Site and Referer", () => {
    expect(isSameOrigin(h({ "sec-fetch-site": "same-origin" }), "http://localhost:8080/", "http://localhost:8080")).toBe(true);
    expect(isSameOrigin(h({ referer: "http://localhost:8080/sites" }), "http://localhost:8080/", "http://localhost:8080")).toBe(true);
  });
});

describe("session keys and revocation", () => {
  it("derives a different key when the admin password changes", () => {
    expect(sessionKey(secret, "one-password")).not.toBe(sessionKey(secret, "two-password"));
    expect(sessionKey(secret, "one-password")).toBe(sessionKey(secret, "one-password"));
  });

  it("gives every token its own session id", () => {
    const a = verifySession(secret, signSession(secret, "a@b.c"));
    const b = verifySession(secret, signSession(secret, "a@b.c"));
    expect(a?.sid).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.sid).not.toBe(b?.sid);
  });

  it("remembers revoked ids until they expire and persists them", async () => {
    const saved: { sid: string; exp: number }[] = [];
    const repo = { loadActive: async () => saved, save: async (sid: string, exp: number) => void saved.push({ sid, exp }) };
    const r = new SessionRevocations(repo);
    await r.revoke("abc", 2000);
    expect(r.isRevoked("abc", 1000)).toBe(true);
    expect(r.isRevoked("abc", 2001)).toBe(false);
    expect(saved).toEqual([{ sid: "abc", exp: 2000 }]);
    const reloaded = new SessionRevocations(repo);
    await reloaded.load(1000);
    expect(reloaded.isRevoked("abc", 1000)).toBe(true);
  });
});

describe("login limiter: global cap and IPv6 /64", () => {
  it("blocks everyone once the global failure cap is reached", () => {
    const rl = new LoginRateLimiter(5, 1000, 3);
    rl.fail("a", 0);
    rl.fail("b", 0);
    rl.fail("c", 0);
    expect(rl.retryAfter("d", 10)).toBe(1);
    expect(rl.retryAfter("d", 1001)).toBe(0);
  });

  it("lets a client that signed in before through the global cap, but not past its own limit", () => {
    const rl = new LoginRateLimiter(2, 1000, 3);
    rl.succeed("10.0.0.1", 0);
    rl.fail("a", 5);
    rl.fail("b", 5);
    rl.fail("c", 5);
    expect(rl.retryAfter("d", 10)).toBe(1);
    // The admin's own address keeps working during a distributed guessing attack.
    expect(rl.retryAfter("10.0.0.1", 10)).toBe(0);
    rl.fail("10.0.0.1", 20);
    rl.fail("10.0.0.1", 20);
    expect(rl.retryAfter("10.0.0.1", 30)).toBe(1);
  });

  it("forgets known clients after the trust period and keeps the list bounded", () => {
    const rl = new LoginRateLimiter(5, 1000, 1, 5000, 2);
    rl.succeed("10.0.0.1", 0);
    rl.succeed("10.0.0.2", 0);
    rl.succeed("10.0.0.3", 0);
    rl.fail("x", 100);
    // At most two known clients are kept; the oldest one was dropped.
    expect(rl.retryAfter("10.0.0.1", 100)).toBeGreaterThan(0);
    expect(rl.retryAfter("10.0.0.3", 100)).toBe(0);
    rl.fail("x", 5500);
    expect(rl.retryAfter("10.0.0.3", 5600)).toBeGreaterThan(0);
  });

  it("keys IPv6 clients by their /64 and IPv4-mapped addresses as IPv4", () => {
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe(clientKey("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(clientKey("2001:db8:1:2::1")).not.toBe(clientKey("2001:db8:1:3::1"));
    expect(clientKey("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(clientKey("192.0.2.7")).toBe("192.0.2.7");
    expect(clientKey("[2001:DB8::1%eth0]")).toBe(clientKey("2001:db8:0:0::2"));
  });
});
