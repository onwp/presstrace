import { ClickHouseError } from "@clickhouse/client";

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** Writes one JSON object per line: {"time":"...","level":"info","msg":"...", ...fields}. */
export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line)): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
    if (fields) {
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && !(k in entry)) entry[k] = v;
    }
    write(`${JSON.stringify(entry)}\n`);
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * A short, data-free description of an error for logs. ClickHouse server errors are reduced to their code and
 * type, because their messages can quote the rows or SQL that failed. Other errors keep a trimmed first line.
 */
export function describeError(error: unknown): string {
  if (error instanceof ClickHouseError) return `ClickHouse error ${error.code}${error.type ? ` ${error.type}` : ""}`;
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === "string" && /^E[A-Z_]+$/.test(e.code)) return e.code;
    if (typeof e.message === "string") return trimLine(e.message);
  }
  return trimLine(String(error));
}

function trimLine(text: string, max = 160): string {
  const first = text.split("\n", 1)[0] ?? "";
  return first.length > max ? `${first.slice(0, max)}...` : first;
}
