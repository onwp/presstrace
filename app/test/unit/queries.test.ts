import { describe, expect, it } from "vitest";
import * as Q from "../../src/server/queries";
import { rangeWindow, parseRange, RANGES } from "../../src/shared/range";
import { fillBuckets, pickSamples } from "../../src/server/reports";

const w = rangeWindow("1h", 1_800_000_000_000);

describe("range", () => {
  it("defaults to 1h and validates keys", () => {
    expect(parseRange(undefined)).toBe("1h");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("1y")).toBe("1h");
  });

  it("computes windows and bucket sizes for every range", () => {
    for (const r of RANGES) {
      const win = rangeWindow(r, 1_800_000_000_000);
      expect(win.to - win.from).toBe(win.seconds * 1000);
      const bars = win.seconds / win.bucketSeconds;
      expect(bars).toBeGreaterThanOrEqual(30);
      expect(bars).toBeLessThanOrEqual(60);
    }
  });
});

describe("query builders", () => {
  it("scope every site query by site and time window with bound parameters", () => {
    const builders = [
      Q.txnSummary("s1", w, ""),
      Q.txnSeries("s1", w, "frontend"),
      Q.txnTable("s1", w, ""),
      Q.componentTable("s1", w),
      Q.callbackTable("s1", w),
      Q.loadTable("s1", w),
      Q.queryTable("s1", w),
      Q.queryComponentTable("s1", w),
      Q.externalTable("s1", w),
      Q.errorTable("s1", w),
      Q.issueRoutes("s1", w),
    ];
    for (const b of builders) {
      expect(b.query).toContain("site_id = {site:String}");
      expect(b.query).toContain("fromUnixTimestamp64Milli({from:Int64}, 'UTC')");
      expect(b.params).toMatchObject({ site: "s1", from: w.from, to: w.to });
      expect(b.query).not.toContain("s1");
    }
  });

  it("uses t-digest quantiles for percentiles", () => {
    expect(Q.txnSummary("s", w, "").query).toContain("quantilesTDigest(0.5, 0.95, 0.99)(duration)");
    expect(Q.txnTable("s", w, "").query).toContain("quantilesTDigest(0.5, 0.95)(duration)");
  });

  it("passes the type filter as a parameter", () => {
    const q = Q.txnTable("s", w, "rest");
    expect(q.params.type).toBe("rest");
    expect(q.query).toContain("({type:String} = '' OR type = {type:String})");
    expect(Q.txnSeries("s", w, "").params.bucket).toBe(w.bucketSeconds);
  });

  it("never aliases an aggregate with a column name used in WHERE", () => {
    expect(Q.txnTable("s", w, "x").query).not.toMatch(/any\(type\) AS type\b/);
    const list = Q.issueList("s", w, { severity: "", type: "", route: "", page: 1, pageSize: 25 }).query;
    expect(list).not.toMatch(/any\(type\) AS type\b/);
    expect(list).not.toMatch(/any\(route\) AS route\b/);
    expect(Q.sampleBase("s", w, "callback", JSON.stringify(["a", "b", "c"])).query).not.toMatch(/AS ts\b/);
  });

  it("paginates and filters issues", () => {
    const q = Q.issueList("s", w, { severity: "high", type: "slow_query", route: "home", page: 3, pageSize: 25 });
    expect(q.params).toMatchObject({ severity: "high", type: "slow_query", route: "home", limit: 25, offset: 50 });
    expect(q.query).toContain("HAVING {severity:String} = ''");
    expect(Q.issueCount("s", w, { severity: "", type: "", route: "", page: 1, pageSize: 25 }).query).toContain("count()");
  });

  it("builds sample bases for every entity", () => {
    expect(Q.sampleBase("s", w, "transaction", "home").query).toContain("name = {key:String}");
    expect(Q.sampleBase("s", w, "component", "plugin:x").query).toContain("ARRAY JOIN");
    const cb = Q.sampleBase("s", w, "callback", JSON.stringify(["fn", "action:init", "plugin:x"]));
    expect(cb.params).toMatchObject({ name: "fn", hook: "action:init", component: "plugin:x" });
    expect(Q.sampleBase("s", w, "query", "123").query).toContain("fp_hash = toUInt64OrZero({key:String})");
    expect(Q.sampleBase("s", w, "external", "POST api.stripe.com").params).toMatchObject({ method: "POST", host: "api.stripe.com" });
    expect(Q.sampleBase("s", w, "error", "abc").query).toContain("FROM errors");
  });

  it("picks samples from one bucketed scan, with the newest rows read next to it", () => {
    const base = Q.sampleBase("s", w, "query", "123");
    const h = Q.sampleHistogram(base);
    expect(h.query).toMatch(/^WITH base AS/);
    expect(h.query.match(/FROM base/g)).toHaveLength(1);
    expect(h.query).toContain("GROUP BY bucket");
    expect(h.params).toMatchObject({ key: "123" });
    expect(Q.sampleRecent(base).params).toMatchObject({ key: "123", limit: 20 });
  });

  it("groups spans per transaction in sort-key order", () => {
    for (const by of ["callback", "query", "external", "error"] as const) {
      const q = Q.sampleBase("s", w, by, by === "callback" ? JSON.stringify(["a", "b", "c"]) : "x").query;
      expect(q).toContain("GROUP BY ts, transaction_id");
      expect(q).toContain("optimize_aggregation_in_order = 1");
    }
  });

  it("aggregates queries by hash and reads fingerprint text only for the top rows", () => {
    const q = Q.queryTable("s1", w).query;
    expect(q).toContain("FROM query_fingerprints");
    expect(q).not.toContain("any(fingerprint) AS fingerprint, topK");
    expect(q).toContain("GROUP BY fp_hash ORDER BY total DESC LIMIT 500");
  });

  it("limits issue details to the selected range", () => {
    for (const b of [Q.issueDetail("s1", "fp", w), Q.issueRecent("s1", "fp", w)]) {
      expect(b.query).toContain("fromUnixTimestamp64Milli({from:Int64}, 'UTC')");
      expect(b.params).toMatchObject({ site: "s1", fp: "fp", from: w.from, to: w.to });
    }
  });

  it("parses callback keys defensively", () => {
    expect(Q.parseCallbackKey("not json")).toEqual(["", "", ""]);
    expect(Q.parseCallbackKey(JSON.stringify([1, 2, 3]))).toEqual(["", "", ""]);
  });

  it("looks up traces by site, id and timestamp", () => {
    const q = Q.traceSpans("s", "abc", 123);
    expect(q.query).toContain("ts = fromUnixTimestamp64Milli({ts:Int64}, 'UTC')");
    expect(q.params).toEqual({ site: "s", id: "abc", ts: 123 });
  });
});

describe("fillBuckets", () => {
  it("fills missing buckets with zeros", () => {
    const size = w.bucketSeconds * 1000;
    const first = Math.floor(w.from / size) * size;
    const filled = fillBuckets([{ t: first + size, requests: 3, php: 10, db: 2, http: 1 }], w);
    expect(filled.length).toBeGreaterThanOrEqual(30);
    expect(filled[0]!.requests).toBe(0);
    expect(filled[1]).toEqual({ t: first + size, requests: 3, php: 10, db: 2, http: 1 });
  });
});

describe("pickSamples", () => {
  const row = (tid: string, ts: number, value: number) => [tid, ts, value];
  it("finds the slowest row and the newest rows of the buckets holding p95 and p50", () => {
    const buckets = [
      { bucket: 20, n: 45, top: row("d", 500, 2.8), newest: row("d", 500, 2.8) },
      { bucket: 10, n: 50, top: row("b", 300, 1.7), newest: row("b", 300, 1.7) },
      { bucket: 40, n: 5, top: row("f", 50, 7.5), newest: row("e", 400, 7.4) },
    ];
    const picked = pickSamples(buckets);
    expect(picked.slowest).toEqual({ tid: "f", ts_ms: 50, value: 7.5 });
    // The 95th of 100 values falls in bucket 20 (cumulative 50, then 95); the 50th in bucket 10.
    expect(picked.p95).toEqual({ tid: "d", ts_ms: 500, value: 2.8 });
    expect(picked.p50).toEqual({ tid: "b", ts_ms: 300, value: 1.7 });
    expect(picked.n).toBe(100);
  });

  it("handles no rows", () => {
    expect(pickSamples([])).toEqual({ n: 0, slowest: null, p95: null, p50: null });
  });
});
