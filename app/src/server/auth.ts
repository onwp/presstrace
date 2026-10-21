import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { queryRows, type CH } from "./db";

export const SESSION_COOKIE = "pt_session";
/**
 * Cookie name on https. The __Host- prefix makes the browser refuse it unless it is Secure, has Path=/ and no
 * Domain, so a subdomain or a plain-http response cannot plant or overwrite it (OWASP ASVS 5.0.0 V3.3.3).
 */
export const SECURE_SESSION_COOKIE = "__Host-pt_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/**
 * The key that signs session tokens. It mixes in a hash of the admin password, so changing ADMIN_PASSWORD (or
 * SESSION_SECRET) makes every existing token invalid.
 */
export function sessionKey(sessionSecret: string, adminPassword: string): string {
  const passwordHash = createHash("sha256").update(adminPassword).digest("hex");
  return createHmac("sha256", sessionSecret).update(`presstrace-session\0${passwordHash}`).digest("hex");
}

export interface Session {
  email: string;
  /** Random id of this token, used to revoke it on sign-out. */
  sid: string;
  exp: number;
}

export function signSession(key: string, email: string, now: number = Date.now()): string {
  const body = b64url(JSON.stringify({ e: email, sid: randomBytes(16).toString("hex"), exp: now + SESSION_TTL_MS }));
  return `${body}.${b64url(hmac(key, body))}`;
}

/** Returns the session when the token is authentic and not expired. */
export function verifySession(key: string, token: string | undefined, now: number = Date.now()): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = hmac(key, body);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { e?: unknown; sid?: unknown; exp?: unknown };
    if (typeof data.e !== "string" || typeof data.sid !== "string" || typeof data.exp !== "number" || data.exp <= now) return null;
    return { email: data.e, sid: data.sid, exp: data.exp };
  } catch {
    return null;
  }
}

/** Persistence port for revoked session ids. */
export interface RevocationRepo {
  loadActive(): Promise<{ sid: string; exp: number }[]>;
  save(sid: string, exp: number): Promise<void>;
}

export function clickhouseRevocationRepo(ch: CH): RevocationRepo {
  return {
    async loadActive() {
      const rows = await queryRows<{ sid: string; exp: number }>(
        ch,
        "SELECT sid, toUnixTimestamp(max(expires_at)) * 1000 AS exp FROM revoked_sessions WHERE expires_at > now() GROUP BY sid",
      );
      return rows.map((r) => ({ sid: r.sid, exp: Number(r.exp) }));
    },
    async save(sid, exp) {
      await ch.insert({
        table: "revoked_sessions",
        values: [{ sid, expires_at: Math.ceil(exp / 1000) }],
        format: "JSONEachRow",
      });
    },
  };
}

/**
 * Session ids revoked by sign-out, kept until the token would have expired anyway. The set lives in memory for
 * fast checks; the repo (a ClickHouse table with a TTL) makes it survive restarts.
 */
export class SessionRevocations {
  private revoked = new Map<string, number>();

  constructor(private readonly repo?: RevocationRepo) {}

  async load(now: number = Date.now()): Promise<void> {
    if (!this.repo) return;
    for (const { sid, exp } of await this.repo.loadActive()) if (exp > now) this.revoked.set(sid, exp);
  }

  isRevoked(sid: string, now: number = Date.now()): boolean {
    const exp = this.revoked.get(sid);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.revoked.delete(sid);
      return false;
    }
    return true;
  }

  async revoke(sid: string, exp: number, now: number = Date.now()): Promise<void> {
    this.revoked.set(sid, exp);
    if (this.revoked.size > 10_000) {
      for (const [id, e] of this.revoked) if (e <= now) this.revoked.delete(id);
    }
    await this.repo?.save(sid, exp);
  }
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(
  expected: { email: string; password: string },
  email: unknown,
  password: unknown,
): boolean {
  if (typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), expected.email);
  const passwordOk = safeEqual(password, expected.password);
  return emailOk && passwordOk;
}

/**
 * Address used to count failed logins. IPv6 clients usually control a whole /64, so they are counted per /64.
 * IPv4-mapped IPv6 addresses count as the IPv4 address.
 */
export function clientKey(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1]!;
  if (!a.includes(":")) return a;
  const [head = "", tail = ""] = a.includes("::") ? a.split("::", 2) : [a, ""];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = a.includes("::") ? Math.max(0, 8 - h.length - t.length) : 0;
  const groups = [...h, ...Array<string>(fill).fill("0"), ...t];
  if (groups.length < 4 || groups.slice(0, 4).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter on failed logins: per client address, plus a cap across all clients so that many
 * addresses cannot share the guessing work. Addresses that signed in successfully during the trust period are
 * exempt from the global cap (never from their own limit), so a distributed guessing attack cannot lock the
 * admin out from the network they normally use.
 */
export class LoginRateLimiter {
  private failures = new Map<string, Window>();
  private global: Window = { count: 0, resetAt: 0 };
  /** Client key to the time its trust ends. Insertion order is refresh order, so the first entry is the oldest. */
  private known = new Map<string, number>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly maxGlobalFailures = 50,
    private readonly trustMs = 30 * 24 * 3600 * 1000,
    private readonly maxKnown = 100,
  ) {}

  private isKnown(key: string, now: number): boolean {
    const until = this.known.get(key);
    if (until === undefined) return false;
    if (until <= now) {
      this.known.delete(key);
      return false;
    }
    return true;
  }

  /** Seconds until the client may try again, or 0 when allowed. */
  retryAfter(client: string, now: number = Date.now()): number {
    let wait = 0;
    const key = clientKey(client);
    if (this.global.resetAt > now && this.global.count >= this.maxGlobalFailures && !this.isKnown(key, now)) {
      wait = Math.ceil((this.global.resetAt - now) / 1000);
    }
    const entry = this.failures.get(key);
    if (entry) {
      if (entry.resetAt <= now) this.failures.delete(key);
      else if (entry.count >= this.maxFailures) wait = Math.max(wait, Math.ceil((entry.resetAt - now) / 1000));
    }
    return wait;
  }

  fail(client: string, now: number = Date.now()): void {
    const key = clientKey(client);
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count++;
    }
    if (this.global.resetAt <= now) this.global = { count: 1, resetAt: now + this.windowMs };
    else this.global.count++;
    if (this.failures.size > 10_000) {
      for (const [k, value] of this.failures) if (value.resetAt <= now) this.failures.delete(k);
    }
  }

  succeed(client: string, now: number = Date.now()): void {
    const key = clientKey(client);
    this.failures.delete(key);
    this.known.delete(key);
    this.known.set(key, now + this.trustMs);
    while (this.known.size > this.maxKnown) {
      const oldest = this.known.keys().next().value;
      if (oldest === undefined) break;
      this.known.delete(oldest);
    }
  }
}

/**
 * Same-origin check for state-changing requests. Browsers always send Origin on
 * cross-origin POST/DELETE, so a mismatch means a cross-site request.
 */
export function isSameOrigin(headers: Headers, requestUrl: string, publicUrl: string): boolean {
  const allowed = new Set([new URL(requestUrl).origin, new URL(publicUrl).origin]);
  const origin = headers.get("origin");
  if (origin) return allowed.has(origin);
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const referer = headers.get("referer");
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}
