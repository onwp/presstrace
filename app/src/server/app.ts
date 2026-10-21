import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Config } from "./config";
import { MAX_DECOMPRESSED_BYTES, validatePayload, withinTimeWindow } from "./payload";
import type { AddResult } from "./batcher";
import { describeError, type Logger } from "./log";
import { TokenBucketLimiter } from "./ratelimit";
import { FailureTracker, securityEvent } from "./security";
import { payloadToRows, type Rows } from "./transform";
import { SiteInputError, validateSiteInput, type SiteRecord, type SiteStore } from "./sites";
import {
  LoginRateLimiter,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionRevocations,
  checkCredentials,
  isSameOrigin,
  sessionKey,
  signSession,
  verifySession,
  type Session,
} from "./auth";
import type { Reports } from "./reports";
import { parseRange, rangeWindow } from "../shared/range";
import { TRANSACTION_TYPES, type SampleBy, type SiteInfo } from "../shared/types";

export interface RowSink {
  add(rows: Rows): AddResult;
}

export interface AppDeps {
  config: Pick<
    Config,
    | "adminEmail"
    | "adminPassword"
    | "sessionSecret"
    | "publicUrl"
    | "trustProxy"
    | "webRoot"
    | "transactionsTtlDays"
    | "enableDebugRoutes"
    | "ingestRatePerSite"
    | "ingestBurstPerSite"
  >;
  sites: SiteStore;
  sink: RowSink;
  reports: Reports | null;
  health?: () => Promise<boolean>;
  limiter?: LoginRateLimiter;
  revocations?: SessionRevocations;
  log: Logger;
}

type Env = { Variables: { site: SiteRecord; session: Session } };

/** Body limits for dashboard requests; agent ingest has its own 2 MB limit. */
export const AUTH_BODY_LIMIT = 16 * 1024;
export const SESSION_BODY_LIMIT = 64 * 1024;

/** Browser features the dashboard never uses, turned off for this origin and any frame. */
export const PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()";

/**
 * Page CSP: only the app's own scripts and styles. React sets style properties through the CSSOM, which CSP does
 * not restrict, so no 'unsafe-inline' is needed.
 */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const SAMPLE_BY: SampleBy[] = ["transaction", "component", "callback", "query", "external", "error"];

export function bearerKey(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

export class PayloadTooLarge extends Error {}

/** Decodes a raw ingest body: gzip when declared or detected by its magic bytes, else plain UTF-8. */
export function decodeBody(raw: Uint8Array, contentEncoding: string | undefined): string {
  const enc = (contentEncoding ?? "").trim().toLowerCase();
  const looksGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (enc === "gzip" || enc === "x-gzip" || looksGzip) {
    try {
      return gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString("utf8");
    } catch (error) {
      if (error instanceof RangeError || (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new PayloadTooLarge("Decompressed payload exceeds 2 MB.");
      }
      throw new SyntaxError("Body is not valid gzip.");
    }
  }
  if (enc !== "" && enc !== "identity") throw new SyntaxError(`Unsupported Content-Encoding "${enc}".`);
  if (raw.length > MAX_DECOMPRESSED_BYTES) throw new PayloadTooLarge("Payload exceeds 2 MB.");
  return new TextDecoder("utf-8", { fatal: false }).decode(raw);
}

function siteInfoFallback(s: SiteRecord): SiteInfo {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    keyHint: s.keyHint,
    createdAt: s.createdAt,
    lastSeen: null,
    phpVersion: "",
    wpVersion: "",
    agentVersion: "",
  };
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config, sites, sink } = deps;
  const limiter = deps.limiter ?? new LoginRateLimiter();
  const revocations = deps.revocations ?? new SessionRevocations();
  const ingestLimiter = new TokenBucketLimiter(config.ingestRatePerSite, config.ingestBurstPerSite);
  const log = deps.log;
  const signingKey = sessionKey(config.sessionSecret, config.adminPassword);
  const secureCookie = config.publicUrl.startsWith("https://");
  const cookieName = secureCookie ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  const badKeys = new FailureTracker();
  const rejectedSessions = new FailureTracker();
  const crossOrigin = new FailureTracker();
  const app = new Hono<Env>();

  app.onError((err, c) => {
    log.error("Unhandled error", { method: c.req.method, path: c.req.path, reason: describeError(err) });
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", PERMISSIONS_POLICY);
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    if (secureCookie) c.header("Strict-Transport-Security", "max-age=31536000");
    if (c.req.path.startsWith("/api/")) {
      // API answers are data for this dashboard only: never cached, never rendered as a page.
      c.header("Cache-Control", "no-store");
      c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    } else {
      c.header("Content-Security-Policy", PAGE_CSP);
    }
  });

  const clientAddress = (c: Context): string => {
    if (config.trustProxy) {
      const fwd = c.req.header("x-forwarded-for");
      // The rightmost entry is the one the trusted reverse proxy added; entries to its left come from the client.
      const last = fwd?.split(",").pop()?.trim();
      if (last) return last;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };

  // ---------------------------------------------------------------- health
  app.get("/healthz", async (c) => {
    const ok = deps.health ? await deps.health().catch(() => false) : true;
    return c.json({ ok }, ok ? 200 : 503);
  });

  // ---------------------------------------------------------------- agent API
  const agentAuth = async (c: Context<Env>, next: () => Promise<void>) => {
    const key = bearerKey(c.req.header("authorization"));
    const site = key ? sites.findByKey(key) : undefined;
    if (!site) {
      const ip = clientAddress(c);
      const seen = badKeys.record(ip);
      if (seen.report) securityEvent(log, "bad_site_key", { ip, path: c.req.path, previousWindowCount: seen.previous });
      return c.json({ error: "Invalid or missing site key" }, 401);
    }
    c.set("site", site);
    await next();
  };

  const ingestRate = async (c: Context<Env>, next: () => Promise<void>) => {
    const wait = ingestLimiter.take(c.get("site").id);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "Too many reports from this site, slow down" }, 429);
    }
    await next();
  };

  const maxAgeMs = config.transactionsTtlDays * 86_400_000;

  app.post(
    "/api/v1/ingest",
    agentAuth,
    ingestRate,
    bodyLimit({
      maxSize: MAX_DECOMPRESSED_BYTES,
      onError: (c) => c.json({ error: "Payload exceeds 2 MB" }, 413),
    }),
    async (c) => {
      const site = c.get("site");
      const raw = new Uint8Array(await c.req.arrayBuffer());
      let text: string;
      try {
        text = decodeBody(raw, c.req.header("content-encoding"));
      } catch (error) {
        if (error instanceof PayloadTooLarge) return c.json({ error: error.message }, 413);
        return c.json({ error: (error as Error).message }, 400);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return c.json({ error: "Body is not valid JSON" }, 400);
      }
      const result = validatePayload(body);
      if (!result.ok) return c.json({ error: "Invalid payload", details: result.errors }, 400);
      const { payload, rejected } = withinTimeWindow(result.payload, Date.now(), maxAgeMs);
      if (payload.transactions.length === 0) {
        return c.json(
          {
            error: `Every transaction timestamp is outside the accepted window (the last ${config.transactionsTtlDays} days to one hour ahead). Check the clock of the WordPress server.`,
          },
          400,
        );
      }
      const rows = payloadToRows(site.id, payload);
      const added = sink.add(rows);
      if (added === "unavailable") {
        c.header("Retry-After", "30");
        return c.json({ error: "Storage is unavailable, payload dropped" }, 503);
      }
      if (added === "full") {
        c.header("Retry-After", "5");
        return c.json({ error: "Server is busy, payload dropped" }, 429);
      }
      return c.json(rejected > 0 ? { ok: true, accepted: rows.transactions.length, rejected } : { ok: true, accepted: rows.transactions.length }, 202);
    },
  );

  app.get("/api/v1/ping", agentAuth, (c) => {
    const site = c.get("site");
    return c.json({ ok: true, site: { id: site.id, name: site.name } });
  });

  // Answers after a delay; the lab uses it as a slow external service. Only registered with
  // ENABLE_DEBUG_ROUTES, and it needs a site key so it cannot be used anonymously to hold connections open.
  if (config.enableDebugRoutes) {
    app.get("/api/v1/debug/delay", agentAuth, async (c) => {
      const raw = Number(c.req.query("ms") ?? "0");
      const ms = Number.isFinite(raw) ? Math.min(5000, Math.max(0, Math.round(raw))) : 0;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return c.json({ ok: true, ms });
    });
  }

  // ---------------------------------------------------------------- session API
  const tooLarge = (c: Context) => c.json({ error: "Request body is too large" }, 413);
  const authBodyLimit = bodyLimit({ maxSize: AUTH_BODY_LIMIT, onError: tooLarge });
  const sessionBodyLimit = bodyLimit({ maxSize: SESSION_BODY_LIMIT, onError: tooLarge });
  app.use("/api/*", (c, next) => {
    if (c.req.path.startsWith("/api/v1/")) return next();
    return (c.req.path.startsWith("/api/auth/") ? authBodyLimit : sessionBodyLimit)(c, next);
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/v1/")) return next();
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && !isSameOrigin(c.req.raw.headers, c.req.url, config.publicUrl)) {
      const ip = clientAddress(c);
      const seen = crossOrigin.record(ip);
      if (seen.report) {
        securityEvent(log, "cross_origin_refused", {
          ip,
          method,
          path: c.req.path,
          origin: (c.req.header("origin") ?? "").slice(0, 200),
          previousWindowCount: seen.previous,
        });
      }
      return c.json({ error: "Cross-origin request refused" }, 403);
    }
    if (c.req.path === "/api/auth/login") return next();
    const token = getCookie(c, cookieName);
    const session = verifySession(signingKey, token);
    const revoked = session !== null && revocations.isRevoked(session.sid);
    if (!session || revoked) {
      // No cookie is the normal signed-out state. A cookie that fails the check is forged, expired, signed with an
      // old password or secret, or was signed out: worth a (rate-limited) log line.
      if (token !== undefined) {
        const ip = clientAddress(c);
        const seen = rejectedSessions.record(ip);
        if (seen.report) {
          securityEvent(log, "session_rejected", { ip, path: c.req.path, reason: revoked ? "revoked" : "invalid", previousWindowCount: seen.previous });
        }
      }
      return c.json({ error: "Not signed in" }, 401);
    }
    c.set("session", session);
    await next();
  });

  app.post("/api/auth/login", async (c) => {
    const client = clientAddress(c);
    // Read the body first: the limit check, the credential check and the failure count then run without an
    // await in between, so parallel requests cannot all pass the check before the first failure is counted.
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const wait = limiter.retryAfter(client);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      securityEvent(log, "login_locked", { ip: client, retryAfter: wait });
      return c.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }, 429);
    }
    if (!body || !checkCredentials({ email: config.adminEmail, password: config.adminPassword }, body.email, body.password)) {
      limiter.fail(client);
      securityEvent(log, "login_failure", { ip: client });
      return c.json({ error: "Email or password is incorrect." }, 401);
    }
    limiter.succeed(client);
    securityEvent(log, "login_success", { ip: client });
    // A new random session id on every sign-in, so a token known before sign-in is never reused (no fixation).
    setCookie(c, cookieName, signSession(signingKey, config.adminEmail), {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookie,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return c.json({ email: config.adminEmail });
  });

  app.post("/api/auth/logout", async (c) => {
    const session = c.get("session");
    try {
      await revocations.revoke(session.sid, session.exp);
    } catch (error) {
      // The id is revoked in memory already; only the copy that survives a restart is missing.
      log.warn("Could not store the revoked session id", { reason: describeError(error) });
    }
    deleteCookie(c, cookieName, { path: "/", secure: secureCookie });
    securityEvent(log, "logout", { ip: clientAddress(c) });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", (c) => c.json({ email: config.adminEmail, publicUrl: config.publicUrl }));

  // ---------------------------------------------------------------- sites
  const reports = () => {
    if (!deps.reports) throw new Error("Reports are not configured");
    return deps.reports;
  };
  const windowOf = (c: Context) => rangeWindow(parseRange(c.req.query("range")));

  app.get("/api/sites", async (c) => {
    return c.json({ sites: await reports().fleet(sites.list(), windowOf(c)) });
  });

  app.post("/api/sites", async (c) => {
    try {
      const input = validateSiteInput(await c.req.json().catch(() => null));
      const { site, key } = await sites.create(input);
      securityEvent(log, "site_create", { ip: clientAddress(c), siteId: site.id });
      return c.json({ site: siteInfoFallback(site), key }, 201);
    } catch (error) {
      if (error instanceof SiteInputError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  const withSite = async (c: Context<Env>, next: () => Promise<void>) => {
    const site = sites.get(c.req.param("id") ?? "");
    if (!site) return c.json({ error: "Site not found" }, 404);
    c.set("site", site);
    await next();
  };

  app.get("/api/sites/:id", withSite, async (c) => c.json(await reports().siteInfo(c.get("site"))));

  app.patch("/api/sites/:id", withSite, async (c) => {
    try {
      const input = validateSiteInput(await c.req.json().catch(() => null));
      const site = await sites.update(c.get("site").id, input);
      securityEvent(log, "site_update", { ip: clientAddress(c), siteId: c.get("site").id });
      return c.json({ site: site ? siteInfoFallback(site) : null });
    } catch (error) {
      if (error instanceof SiteInputError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.post("/api/sites/:id/rotate", withSite, async (c) => {
    const rotated = await sites.rotate(c.get("site").id);
    if (!rotated) return c.json({ error: "Site not found" }, 404);
    securityEvent(log, "site_key_rotate", { ip: clientAddress(c), siteId: rotated.site.id });
    return c.json({ site: siteInfoFallback(rotated.site), key: rotated.key });
  });

  app.delete("/api/sites/:id", withSite, async (c) => {
    await sites.remove(c.get("site").id);
    securityEvent(log, "site_delete", { ip: clientAddress(c), siteId: c.get("site").id });
    return c.json({ ok: true });
  });

  app.get("/api/sites/:id/transactions", withSite, async (c) => {
    const type = c.req.query("type") ?? "";
    const safeType = (TRANSACTION_TYPES as readonly string[]).includes(type) ? type : "";
    return c.json(await reports().transactions(c.get("site").id, windowOf(c), safeType));
  });

  app.get("/api/sites/:id/wordpress", withSite, async (c) => c.json(await reports().wordpress(c.get("site").id, windowOf(c))));
  app.get("/api/sites/:id/database", withSite, async (c) => c.json(await reports().database(c.get("site").id, windowOf(c))));
  app.get("/api/sites/:id/external", withSite, async (c) =>
    c.json({ rows: await reports().external(c.get("site").id, windowOf(c)) }),
  );
  app.get("/api/sites/:id/errors", withSite, async (c) =>
    c.json({ rows: await reports().errors(c.get("site").id, windowOf(c)) }),
  );

  app.get("/api/sites/:id/issues", withSite, async (c) => {
    const severity = c.req.query("severity") ?? "";
    const page = Math.max(1, Math.min(10_000, Number.parseInt(c.req.query("page") ?? "1", 10) || 1));
    return c.json(
      await reports().issues(c.get("site").id, windowOf(c), {
        severity: severity === "high" || severity === "medium" || severity === "low" ? severity : "",
        type: (c.req.query("type") ?? "").slice(0, 50),
        route: (c.req.query("route") ?? "").slice(0, 300),
        page,
        pageSize: 25,
      }),
    );
  });

  app.get("/api/sites/:id/issues/:fp", withSite, async (c) => {
    const issue = await reports().issue(c.get("site").id, (c.req.param("fp") ?? "").slice(0, 200), windowOf(c));
    return issue ? c.json(issue) : c.json({ error: "Issue not found in this time range" }, 404);
  });

  app.get("/api/sites/:id/samples", withSite, async (c) => {
    const by = c.req.query("by") as SampleBy;
    const key = c.req.query("key") ?? "";
    if (!SAMPLE_BY.includes(by) || key === "" || key.length > 2000) {
      return c.json({ error: "Query parameters by and key are required" }, 400);
    }
    return c.json(await reports().samples(c.get("site").id, windowOf(c), by, key));
  });

  app.get("/api/sites/:id/traces/:tid", withSite, async (c) => {
    const tid = (c.req.param("tid") ?? "").toLowerCase();
    if (!/^[0-9a-f]{16,64}$/.test(tid)) return c.json({ error: "Invalid transaction id" }, 400);
    const trace = await reports().trace(c.get("site").id, tid);
    return trace ? c.json(trace) : c.json({ error: "Trace not found. It may be older than the span retention period." }, 404);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // ---------------------------------------------------------------- SPA
  const root = path.resolve(config.webRoot);
  app.use(
    "/assets/*",
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  const staticFiles = serveStatic({ root });
  // Only real files are served statically; "/" and app routes fall through to index.html below. A path that
  // names a file which does not exist gets 404, not the dashboard page.
  app.use("*", async (c, next) => {
    if (c.req.path === "/" || !/\.[a-z0-9]+$/i.test(c.req.path)) return next();
    const res = await staticFiles(c, async () => {});
    return res ?? c.text("Not found", 404);
  });
  let indexHtml: string | null = null;
  app.get("*", async (c) => {
    if (indexHtml === null) {
      try {
        indexHtml = await readFile(path.join(root, "index.html"), "utf8");
      } catch {
        return c.text("Dashboard build not found. Run pnpm build.", 500);
      }
    }
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });

  return app;
}
