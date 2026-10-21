import { ClickHouseLogLevel, createClient, type ClickHouseClient } from "@clickhouse/client";
import type { Config } from "./config";
import { describeError, silentLogger, type Logger } from "./log";

export type CH = ClickHouseClient;

let clientLog: Logger = silentLogger;
const lastLogged = new Map<string, number>();

/** Routes the ClickHouse client's own warnings and errors to the app log. */
export function setClickHouseLogger(log: Logger): void {
  clientLog = log;
}

interface ClientLogParams {
  module: string;
  message: string;
  err?: Error;
}

/**
 * One short line per client warning or error, at most once a minute per message. The client's arguments are
 * left out because they can hold query text; errors are reduced to their code by describeError.
 */
class ClientLogger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(p: ClientLogParams): void {
    this.emit("warn", p);
  }
  error(p: ClientLogParams): void {
    this.emit("error", p);
  }
  private emit(level: "warn" | "error", { module, message, err }: ClientLogParams): void {
    const key = `${level}:${module}:${message}`;
    const now = Date.now();
    if (now - (lastLogged.get(key) ?? 0) < 60_000) return;
    lastLogged.set(key, now);
    if (lastLogged.size > 1000) lastLogged.clear();
    clientLog[level](`ClickHouse client: ${message.split("\n", 1)[0]!.slice(0, 160)}`, {
      module,
      reason: err ? describeError(err) : undefined,
    });
  }
}

const clientLogConfig = { LoggerClass: ClientLogger, level: ClickHouseLogLevel.WARN };

/** Database names are interpolated into DDL, so only allow plain identifiers. */
export function assertIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new Error(`Invalid ClickHouse identifier "${name}".`);
  }
  return name;
}

export async function connect(cfg: Config["clickhouse"]): Promise<CH> {
  const database = assertIdentifier(cfg.database);
  const bootstrap = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    request_timeout: 30_000,
    log: clientLogConfig,
  });
  try {
    await bootstrap.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
  } finally {
    await bootstrap.close();
  }
  return createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database,
    request_timeout: 30_000,
    compression: { request: true, response: true },
    log: clientLogConfig,
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      output_format_json_quote_64bit_integers: 0,
    },
  });
}

export async function waitForClickHouse(cfg: Config["clickhouse"], attempts = 60, delayMs = 1000): Promise<void> {
  const client = createClient({ url: cfg.url, username: cfg.username, password: cfg.password, request_timeout: 5000, log: clientLogConfig });
  try {
    for (let i = 1; i <= attempts; i++) {
      const res = await client.ping().catch((error: unknown) => ({ success: false as const, error }));
      if (res.success) return;
      if (i === attempts) {
        const reason = "error" in res && res.error instanceof Error ? res.error.message : "no response";
        throw new Error(`ClickHouse at ${cfg.url} is not reachable after ${attempts} attempts: ${reason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } finally {
    await client.close();
  }
}

export async function queryRows<T>(ch: CH, query: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const rs = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  return rs.json<T>();
}
