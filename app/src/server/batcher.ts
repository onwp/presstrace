import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ClickHouseError } from "@clickhouse/client";
import type { CH } from "./db";
import { describeError, type Logger } from "./log";
import type { Rows } from "./transform";

/**
 * Writes JSON lines (one row each, no trailing newline) into a table. A retried batch comes with the same rows
 * and token, so ClickHouse can drop it when an earlier attempt was stored after all (for example when the
 * client timed out but the server went on).
 */
export type Inserter = (table: string, lines: string[], token: string) => Promise<void>;

/** Settings for every batch insert. */
export const INSERT_SETTINGS = {
  // A batch mixes rows from many sites. Agents with odd clocks must not make the whole batch fail because it
  // touches many daily partitions; the ingest API already limits timestamps to the retention window.
  throw_on_max_partitions_per_insert_block: 0,
} as const;

export function clickhouseInserter(ch: CH): Inserter {
  return async (table, lines, token) => {
    const result = await ch.exec({
      query: `INSERT INTO ${table} FORMAT JSONEachRow`,
      values: Readable.from(chunks(lines), { objectMode: false }),
      clickhouse_settings: { ...INSERT_SETTINGS, insert_deduplicate: 1, insert_deduplication_token: token },
    });
    // An INSERT answers with an empty body; drain it so the connection goes back to the pool.
    await new Promise<void>((resolve) => {
      result.stream.on("end", resolve).on("error", () => resolve()).on("close", resolve);
      result.stream.resume();
    });
  };
}

function* chunks(lines: string[], perChunk = 1000): Generator<string> {
  for (let i = 0; i < lines.length; i += perChunk) {
    yield `${lines.slice(i, i + perChunk).join("\n")}\n`;
  }
}

export type AddResult = "ok" | "full" | "unavailable";

export interface BatcherOptions {
  /** How often buffered rows are written. */
  flushIntervalMs?: number;
  /** Hard cap on the approximate size of rows waiting in memory; beyond it new payloads are refused. */
  maxBufferedBytes?: number;
  /** Largest insert per table per flush cycle. */
  maxInsertBytes?: number;
  /** Buffer size that starts a flush before the next interval. */
  flushAtBytes?: number;
  /** First retry delay after a failed insert; it doubles up to retryMaxMs. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** An insert still running after this long counts as ClickHouse being unavailable (paused, overloaded, cut off). */
  slowInsertMs?: number;
  /** How often a batch that ClickHouse itself rejects (a non-transient server error) is retried before it is dropped. */
  maxAttempts?: number;
  log: Logger;
}

type Table = keyof Rows;
const TABLES: Record<Table, string> = {
  transactions: "transactions",
  spans: "spans",
  issues: "issue_events",
  errors: "errors",
};
// Transactions first, so a stored span always has its transaction row.
const ORDER: Table[] = ["transactions", "spans", "errors", "issues"];

/** Fixed per-row overhead (string header, array slot) added to the JSON length. */
const ROW_OVERHEAD = 32;

/** ClickHouse error codes that mean "try again later" rather than "this data is bad". */
const TRANSIENT_CODES = new Set([
  "3", // UNEXPECTED_END_OF_FILE
  "159", // TIMEOUT_EXCEEDED
  "164", // READONLY
  "202", // TOO_MANY_SIMULTANEOUS_QUERIES
  "203", // NO_FREE_CONNECTION
  "209", // SOCKET_TIMEOUT
  "210", // NETWORK_ERROR
  "241", // MEMORY_LIMIT_EXCEEDED
  "242", // TABLE_IS_READ_ONLY
  "252", // TOO_MANY_PARTS
  "394", // QUERY_WAS_CANCELLED
  "425", // SYSTEM_ERROR
  "439", // CANNOT_SCHEDULE_TASK
  "516", // AUTHENTICATION_FAILED (password rotation in progress)
  "1000", // POCO_EXCEPTION
]);

export function isTransient(error: unknown): boolean {
  return !(error instanceof ClickHouseError) || TRANSIENT_CODES.has(error.code);
}

interface Buffer {
  lines: string[];
  bytes: number;
}

interface Batch extends Buffer {
  token: string;
}

/**
 * Buffers rows in memory and writes them in batches, so many small ingest requests from many sites become a
 * few large inserts (few parts in ClickHouse). One flush loop runs at a time. Each cycle writes every table at
 * most once, so steady traffic to one table cannot hold back the others. When ClickHouse is unreachable the
 * rows stay buffered (up to maxBufferedBytes) and the loop retries with backoff.
 */
export class Batcher {
  private buffers: Record<Table, Buffer> = {
    transactions: { lines: [], bytes: 0 },
    spans: { lines: [], bytes: 0 },
    issues: { lines: [], bytes: 0 },
    errors: { lines: [], bytes: 0 },
  };
  /** A batch whose insert failed; it is retried as is before newer rows of its table. */
  private pending: Record<Table, Batch | null> = { transactions: null, spans: null, issues: null, errors: null };
  private bytes = 0;
  private rejected: Record<Table, number> = { transactions: 0, spans: 0, issues: 0, errors: 0 };
  private failures = 0;
  private retryAt = 0;
  private lastFailureLog = 0;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private insertStartedAt = 0;
  private again = false;
  private readonly opts: Required<BatcherOptions>;

  constructor(
    private readonly insert: Inserter,
    opts: BatcherOptions,
  ) {
    this.opts = {
      flushIntervalMs: opts.flushIntervalMs ?? 1000,
      maxBufferedBytes: opts.maxBufferedBytes ?? 64 * 1024 * 1024,
      maxInsertBytes: opts.maxInsertBytes ?? 16 * 1024 * 1024,
      flushAtBytes: opts.flushAtBytes ?? 4 * 1024 * 1024,
      retryBaseMs: opts.retryBaseMs ?? 1000,
      retryMaxMs: opts.retryMaxMs ?? 30_000,
      slowInsertMs: opts.slowInsertMs ?? 10_000,
      maxAttempts: opts.maxAttempts ?? 5,
      log: opts.log,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (Date.now() >= this.retryAt) void this.flush();
    }, this.opts.flushIntervalMs);
    this.timer.unref();
  }

  /** Approximate bytes of rows waiting to be written, including a batch that is being written. */
  get bufferedBytes(): number {
    return this.bytes;
  }

  get bufferedRows(): number {
    return ORDER.reduce((n, k) => n + this.buffers[k].lines.length + (this.pending[k]?.lines.length ?? 0), 0);
  }

  /** False while inserts fail with a transient error or hang (ClickHouse down, overloaded or unreachable). */
  get healthy(): boolean {
    if (this.failures > 0) return false;
    return this.insertStartedAt === 0 || Date.now() - this.insertStartedAt < this.opts.slowInsertMs;
  }

  /** Queues rows. When the buffer is full it returns "unavailable" if ClickHouse is failing, else "full". */
  add(rows: Rows): AddResult {
    const lines: Record<Table, string[]> = { transactions: [], spans: [], issues: [], errors: [] };
    const sizes: Record<Table, number> = { transactions: 0, spans: 0, issues: 0, errors: 0 };
    let incoming = 0;
    for (const key of ORDER) {
      for (const row of rows[key]) {
        const line = JSON.stringify(row);
        lines[key].push(line);
        sizes[key] += line.length + ROW_OVERHEAD;
      }
      incoming += sizes[key];
    }
    if (this.bytes + incoming > this.opts.maxBufferedBytes) return this.healthy ? "full" : "unavailable";
    for (const key of ORDER) {
      if (lines[key].length === 0) continue;
      const buf = this.buffers[key];
      for (const line of lines[key]) buf.lines.push(line);
      buf.bytes += sizes[key];
    }
    this.bytes += incoming;
    if (this.bytes >= this.opts.flushAtBytes && Date.now() >= this.retryAt) void this.flush();
    return "ok";
  }

  /**
   * Writes what is buffered. Callers that arrive while a flush runs share it, and the loop runs one more cycle
   * for the rows they added. A failed cycle ends the loop; the timer retries after the backoff.
   */
  flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          if (!(await this.cycle())) break;
        } while (this.again && this.bytes > 0);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** One pass over the tables in order, at most one insert each. Returns false when an insert failed. */
  private async cycle(): Promise<boolean> {
    for (const key of ORDER) {
      const buf = this.buffers[key];
      let batch = this.pending[key];
      if (!batch) {
        if (buf.lines.length === 0) continue;
        batch = { ...this.take(buf), token: randomUUID() };
      }
      this.insertStartedAt = Date.now();
      try {
        await this.insert(TABLES[key], batch.lines, batch.token);
      } catch (error) {
        this.insertStartedAt = 0;
        this.pending[key] = batch;
        this.onFailure(key, error);
        return false;
      }
      this.insertStartedAt = 0;
      // After a retried batch, newer rows of this table are still waiting: run another cycle right away.
      if (this.pending[key] && buf.lines.length > 0) this.again = true;
      this.pending[key] = null;
      this.bytes -= batch.bytes;
      this.rejected[key] = 0;
      this.onSuccess();
    }
    return true;
  }

  private take(buf: Buffer): Buffer {
    if (buf.bytes <= this.opts.maxInsertBytes) {
      const all = { lines: buf.lines, bytes: buf.bytes };
      buf.lines = [];
      buf.bytes = 0;
      return all;
    }
    let bytes = 0;
    let n = 0;
    while (n < buf.lines.length && (n === 0 || bytes + buf.lines[n]!.length + ROW_OVERHEAD <= this.opts.maxInsertBytes)) {
      bytes += buf.lines[n]!.length + ROW_OVERHEAD;
      n++;
    }
    const lines = buf.lines.splice(0, n);
    buf.bytes -= bytes;
    return { lines, bytes };
  }

  private onSuccess(): void {
    if (this.failures === 0) return;
    this.opts.log.info("ClickHouse inserts recovered", { failedAttempts: this.failures, bufferedBytes: this.bytes });
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailureLog = 0;
  }

  private onFailure(key: Table, error: unknown): void {
    const reason = describeError(error);
    const now = Date.now();
    if (!isTransient(error)) {
      // ClickHouse is up but refuses this data. Retry a few times, then drop it so it cannot block the others.
      this.rejected[key]++;
      this.retryAt = now + this.opts.retryBaseMs;
      if (this.rejected[key] >= this.opts.maxAttempts) {
        const dropped = this.pending[key] ?? { lines: [], bytes: 0 };
        this.pending[key] = null;
        this.bytes -= dropped.bytes;
        this.rejected[key] = 0;
        this.opts.log.error(`Dropped ${dropped.lines.length} ${TABLES[key]} rows that ClickHouse rejected`, {
          attempts: this.opts.maxAttempts,
          reason,
        });
      } else {
        this.opts.log.warn(`Insert into ${TABLES[key]} rejected, will retry`, { attempt: this.rejected[key], reason });
      }
      return;
    }
    this.failures++;
    const delay = Math.min(this.opts.retryMaxMs, this.opts.retryBaseMs * 2 ** Math.min(this.failures - 1, 20));
    this.retryAt = now + delay;
    if (this.failures === 1 || now - this.lastFailureLog >= 60_000) {
      this.lastFailureLog = now;
      this.opts.log.warn("ClickHouse inserts failing, keeping rows in memory and retrying", {
        table: TABLES[key],
        failedAttempts: this.failures,
        retryInMs: delay,
        bufferedBytes: this.bytes,
        reason,
      });
    }
  }

  /**
   * Stops the timer and writes what is left, giving up at the deadline. Returns the number of rows that could
   * not be written.
   */
  async stop(timeoutMs = 15_000): Promise<number> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + timeoutMs;
    while (this.bytes > 0) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([this.flush(), new Promise<void>((r) => (timeout = setTimeout(r, left)))]);
      clearTimeout(timeout);
      if (this.bytes > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, Math.min(Math.max(0, this.retryAt - Date.now()), 1000, Math.max(0, deadline - Date.now()))));
      }
    }
    return this.bufferedRows;
  }
}
