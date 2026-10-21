import { describe, expect, it } from "vitest";
import { ClickHouseError } from "@clickhouse/client";
import { Batcher } from "../../src/server/batcher";
import type { Logger } from "../../src/server/log";
import type { Rows } from "../../src/server/transform";

const rows = (n: number, extra: Partial<Rows> = {}): Rows => ({
  transactions: Array.from({ length: n }, (_, i) => ({ id: `t${i}` })) as never[],
  spans: [],
  issues: [],
  errors: [],
  ...extra,
});
const spans = (n: number) => Array.from({ length: n }, (_, i) => ({ seq: i })) as never[];

function captureLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (msg: string, fields?: object) => void lines.push(`${level} ${msg} ${JSON.stringify(fields ?? {})}`);
  return { lines, info: push("info"), warn: push("warn"), error: push("error") };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Batcher", () => {
  it("writes transactions first, then spans, errors and issue events", async () => {
    const calls: [string, number][] = [];
    const b = new Batcher(async (table, lines) => void calls.push([table, lines.length]), { log: captureLog() });
    b.add(rows(2, { spans: spans(1), errors: [{} as never], issues: [{} as never] }));
    await b.flush();
    expect(calls).toEqual([
      ["transactions", 2],
      ["spans", 1],
      ["errors", 1],
      ["issue_events", 1],
    ]);
    expect(b.bufferedBytes).toBe(0);
  });

  it("hands the inserter one JSON line per row", async () => {
    const seen: string[][] = [];
    const b = new Batcher(async (_t, lines) => void seen.push(lines), { log: captureLog() });
    b.add(rows(1));
    await b.flush();
    expect(seen[0]).toEqual(['{"id":"t0"}']);
  });

  it("does not starve other tables while rows keep arriving (each table at most once per cycle)", async () => {
    const calls: string[] = [];
    let b: Batcher;
    let refills = 0;
    b = new Batcher(
      async (table) => {
        calls.push(table);
        // Steady load: every transactions insert sees new transactions arrive meanwhile.
        if (table === "transactions" && refills++ < 50) b.add(rows(10));
        await tick();
      },
      { log: captureLog() },
    );
    b.add(rows(10, { spans: spans(5) }));
    await b.flush();
    expect(calls.slice(0, 2)).toEqual(["transactions", "spans"]);
    // Within one cycle no table repeats before every other table with rows has had its turn.
    const firstSpans = calls.indexOf("spans");
    expect(calls.slice(0, firstSpans).filter((t) => t === "transactions")).toHaveLength(1);
  });

  it("runs a single flush at a time, however many callers ask", async () => {
    let active = 0;
    let peak = 0;
    const b = new Batcher(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      { flushAtBytes: 1, log: captureLog() },
    );
    const waits: Promise<void>[] = [];
    for (let i = 0; i < 7; i++) {
      b.add(rows(1, { spans: spans(1) }));
      waits.push(b.flush());
    }
    await Promise.all(waits);
    await b.flush();
    expect(peak).toBe(1);
    expect(b.bufferedBytes).toBe(0);
  });

  it("caps the buffer by approximate bytes", () => {
    const b = new Batcher(async () => {}, { maxBufferedBytes: 300, flushAtBytes: 10_000, log: captureLog() });
    expect(b.add(rows(5))).toBe("ok");
    const big = rows(1);
    big.transactions = [{ id: "x".repeat(500) }] as never[];
    expect(b.add(big)).toBe("full");
    expect(b.bufferedBytes).toBeGreaterThan(0);
    expect(b.bufferedBytes).toBeLessThanOrEqual(300);
  });

  it("keeps rows while ClickHouse is down, reports unavailable when full, and loses nothing on recovery", async () => {
    let down = true;
    const inserted: string[] = [];
    const log = captureLog();
    const b = new Batcher(
      async (_t, lines) => {
        if (down) throw Object.assign(new Error("connect ECONNREFUSED 172.18.0.2:8123"), { code: "ECONNREFUSED" });
        inserted.push(...lines);
      },
      { maxBufferedBytes: 200, flushAtBytes: 10_000, retryBaseMs: 1, retryMaxMs: 2, log },
    );
    expect(b.add(rows(3))).toBe("ok");
    for (let i = 0; i < 10; i++) await b.flush();
    expect(b.healthy).toBe(false);
    let result = b.add(rows(1));
    while (result === "ok") result = b.add(rows(1));
    expect(result).toBe("unavailable");
    const buffered = b.bufferedRows;
    down = false;
    await new Promise((r) => setTimeout(r, 5));
    await b.flush();
    expect(inserted).toHaveLength(buffered);
    expect(b.healthy).toBe(true);
    expect(b.add(rows(1))).toBe("ok");
    // One line when inserts start failing and one when they recover, not one per attempt.
    expect(log.lines.filter((l) => l.includes("ECONNREFUSED")).length).toBeLessThanOrEqual(2);
    expect(log.lines.some((l) => l.includes("recovered"))).toBe(true);
  });

  it("retries a failed batch with exactly the same rows and deduplication token", async () => {
    const calls: { lines: string[]; token: string }[] = [];
    let fail = true;
    const b = new Batcher(
      async (_t, lines, token) => {
        calls.push({ lines: [...lines], token });
        if (fail) throw new Error("Timeout error.");
      },
      { retryBaseMs: 1, retryMaxMs: 1, log: captureLog() },
    );
    b.add(rows(2));
    await b.flush();
    b.add(rows(1));
    fail = false;
    await new Promise((r) => setTimeout(r, 3));
    await b.flush();
    await b.flush();
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]!.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[2]!.token).not.toBe(calls[0]!.token);
    expect(calls[2]!.lines).toHaveLength(1);
    expect(b.bufferedRows).toBe(0);
  });

  it("counts an insert that hangs (ClickHouse paused or unreachable) as unavailable", async () => {
    let release: () => void = () => {};
    const b = new Batcher(() => new Promise<void>((r) => (release = r)), {
      maxBufferedBytes: 200,
      flushAtBytes: 10_000,
      slowInsertMs: 5,
      log: captureLog(),
    });
    b.add(rows(1));
    const flushing = b.flush();
    await new Promise((r) => setTimeout(r, 15));
    expect(b.healthy).toBe(false);
    let result = b.add(rows(1));
    while (result === "ok") result = b.add(rows(1));
    expect(result).toBe("unavailable");
    release();
    await flushing;
    expect(b.healthy).toBe(true);
  });

  it("answers full (not unavailable) when ClickHouse is healthy but the buffer is full", () => {
    const b = new Batcher(async () => {}, { maxBufferedBytes: 30, flushAtBytes: 10_000, log: captureLog() });
    let result = b.add(rows(1));
    while (result === "ok") result = b.add(rows(1));
    expect(result).toBe("full");
  });

  it("skips spans in a cycle whose transactions insert failed, so traces stay consistent", async () => {
    const calls: string[] = [];
    let fail = true;
    const b = new Batcher(
      async (table) => {
        calls.push(table);
        if (fail && table === "transactions") throw new Error("socket hang up");
      },
      { retryBaseMs: 1, retryMaxMs: 1, log: captureLog() },
    );
    b.add(rows(1, { spans: spans(2) }));
    await b.flush();
    expect(calls).toEqual(["transactions"]);
    fail = false;
    await new Promise((r) => setTimeout(r, 3));
    await b.flush();
    expect(calls).toEqual(["transactions", "transactions", "spans"]);
  });

  it("drops a batch that ClickHouse keeps rejecting, without logging row data", async () => {
    const log = captureLog();
    let attempts = 0;
    const b = new Batcher(
      async () => {
        attempts++;
        throw new ClickHouseError({
          message: "Cannot parse input: expected '\"' before: 'secret-row-data'",
          code: "27",
          type: "CANNOT_PARSE_INPUT_ASSERTION_FAILED",
        });
      },
      { maxAttempts: 2, retryBaseMs: 1, retryMaxMs: 1, log },
    );
    b.add(rows(1));
    await b.flush();
    expect(b.bufferedRows).toBe(1);
    await new Promise((r) => setTimeout(r, 3));
    await b.flush();
    expect(attempts).toBe(2);
    expect(b.bufferedRows).toBe(0);
    expect(log.lines.join("\n")).not.toContain("secret-row-data");
    expect(log.lines.at(-1)).toContain("Dropped 1 transactions rows");
    expect(log.lines.at(-1)).toContain("CANNOT_PARSE_INPUT_ASSERTION_FAILED");
  });

  it("stop() flushes what is left within the deadline", async () => {
    let inserted = 0;
    const b = new Batcher(async (_t, r) => void (inserted += r.length), { log: captureLog() });
    b.start();
    b.add(rows(4));
    expect(await b.stop(1000)).toBe(0);
    expect(inserted).toBe(4);
  });

  it("stop() gives up at the deadline when ClickHouse is down and reports what is left", async () => {
    const b = new Batcher(
      async () => {
        throw new Error("down");
      },
      { retryBaseMs: 5, retryMaxMs: 5, log: captureLog() },
    );
    b.add(rows(3));
    const started = Date.now();
    expect(await b.stop(100)).toBe(3);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
