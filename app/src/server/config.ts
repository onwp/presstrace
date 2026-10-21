export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  adminEmail: string;
  adminPassword: string;
  sessionSecret: string;
  transactionsTtlDays: number;
  spansTtlDays: number;
  trustProxy: boolean;
  /** Registers /api/v1/debug/delay, which the development lab uses as a slow external service. */
  enableDebugRoutes: boolean;
  /** Ingest requests per second per site (token bucket refill rate); 0 turns the limit off. */
  ingestRatePerSite: number;
  /** Ingest requests a site may send at once before the rate applies. */
  ingestBurstPerSite: number;
  /** Cap on rows waiting in memory for ClickHouse, in bytes. */
  bufferMaxBytes: number;
  /** Host address Compose publishes the app on (APP_BIND), used only for a start-up warning. */
  appBind: string;
  clickhouse: {
    url: string;
    username: string;
    password: string;
    database: string;
  };
  webRoot: string;
}

export class ConfigError extends Error {}

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}, got "${raw}".`);
  }
  return value;
}

const flag = (raw: string | undefined) => raw === "1" || raw?.toLowerCase() === "true";

/** True when the app can be reached on every interface, so X-Forwarded-For could come from anyone. */
export function trustProxyExposed(config: Pick<Config, "trustProxy" | "host" | "appBind">): boolean {
  if (!config.trustProxy) return false;
  const bind = config.appBind || config.host;
  return bind === "0.0.0.0" || bind === "::" || bind === "[::]" || bind === "*";
}

const LOOPBACK_HOST_RE = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * True when PUBLIC_URL is plain http on a host other than this machine. The browser then sends the session
 * cookie and the sign-in password, and agents send their site keys, over the network in clear text.
 */
export function insecurePublicUrl(publicUrl: string): boolean {
  const url = new URL(publicUrl);
  return url.protocol === "http:" && !LOOPBACK_HOST_RE.test(url.hostname);
}

/** Minimum admin password length (OWASP ASVS 5.0.0 V6.2.1 asks for at least 8 and recommends 15). */
export const MIN_PASSWORD_LENGTH = 12;

/** Words that mark a value copied from an example instead of chosen. */
const PLACEHOLDER_RE = /change.?me|replace|placeholder|example|choose|long.?password|your.?(password|secret)|^(password|admin|secret|presstrace|letmein|qwerty)/i;

const distinctChars = (s: string) => new Set(s).size;

/** True for placeholders, well-known weak passwords, very repetitive ones and the admin email itself. */
export function weakPassword(password: string, email: string): boolean {
  const p = password.trim().toLowerCase();
  if (PLACEHOLDER_RE.test(p) || /^(?:123456789|987654321|111111111)/.test(p)) return true;
  if (distinctChars(p) < 5) return true;
  return email !== "" && (p === email || p === email.split("@")[0]);
}

/** True for placeholders and strings with too few distinct characters to be random, or that reuse the password. */
export function weakSecret(secret: string, adminPassword: string): boolean {
  if (PLACEHOLDER_RE.test(secret) || distinctChars(secret) < 10) return true;
  return adminPassword !== "" && secret.includes(adminPassword);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const adminPassword = env.ADMIN_PASSWORD ?? "";
  const sessionSecret = env.SESSION_SECRET ?? "";
  const adminEmail = (env.ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  if (adminPassword === "") {
    problems.push("ADMIN_PASSWORD is not set. Set it in .env to the password for the dashboard login.");
  } else if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  } else if (weakPassword(adminPassword, adminEmail)) {
    problems.push("ADMIN_PASSWORD is a placeholder or a well-known weak password. Pick a long random one, for example: openssl rand -base64 18");
  }
  if (sessionSecret === "") {
    problems.push("SESSION_SECRET is not set. Generate one with: openssl rand -hex 32");
  } else if (sessionSecret.length < 32) {
    problems.push("SESSION_SECRET must be at least 32 characters long. Generate one with: openssl rand -hex 32");
  } else if (weakSecret(sessionSecret, adminPassword)) {
    problems.push("SESSION_SECRET looks like a placeholder or is not random. Generate one with: openssl rand -hex 32");
  }
  if (problems.length > 0) {
    throw new ConfigError(`PressTrace cannot start:\n- ${problems.join("\n- ")}`);
  }

  const port = intFromEnv(env, "PORT", 8080, 1, 65535);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
  try {
    new URL(publicUrl);
  } catch {
    throw new ConfigError(`PUBLIC_URL must be an absolute URL such as https://apm.example.com, got "${publicUrl}".`);
  }

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    publicUrl,
    adminEmail,
    adminPassword,
    sessionSecret,
    transactionsTtlDays: intFromEnv(env, "TRANSACTIONS_TTL_DAYS", 30, 1, 3650),
    spansTtlDays: intFromEnv(env, "SPANS_TTL_DAYS", 7, 1, 3650),
    trustProxy: flag(env.TRUST_PROXY),
    enableDebugRoutes: flag(env.ENABLE_DEBUG_ROUTES),
    ingestRatePerSite: intFromEnv(env, "INGEST_RATE_PER_SITE", 20, 0, 100_000),
    ingestBurstPerSite: intFromEnv(env, "INGEST_BURST_PER_SITE", 100, 1, 1_000_000),
    bufferMaxBytes: intFromEnv(env, "BUFFER_MAX_MB", 64, 1, 4096) * 1024 * 1024,
    appBind: (env.APP_BIND ?? "").trim(),
    clickhouse: {
      url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: env.CLICKHOUSE_USER ?? "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      database: env.CLICKHOUSE_DATABASE ?? "presstrace",
    },
    webRoot: env.WEB_ROOT ?? "dist/web",
  };
}
