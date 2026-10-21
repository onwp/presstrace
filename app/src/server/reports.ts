import type { CH } from "./db";
import { queryRows } from "./db";
import * as Q from "./queries";
import type { Window } from "../shared/range";
import type {
  DatabaseResponse,
  ErrorGroup,
  ExternalRow,
  IssueDetail,
  IssueGroup,
  IssuesResponse,
  IssueType,
  Sample,
  SampleBy,
  SamplesResponse,
  Severity,
  SiteInfo,
  SiteSummary,
  TimeBucket,
  Trace,
  TraceSpan,
  TransactionsResponse,
  WordPressResponse,
} from "../shared/types";
import type { SiteRecord } from "./sites";

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const q = (arr: unknown, i: number) => (Array.isArray(arr) ? num(arr[i]) : 0);
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

async function run<T>(ch: CH, query: Q.Q): Promise<T[]> {
  return queryRows<T>(ch, query.query, query.params);
}

type Raw = Record<string, unknown>;

/** Fills empty buckets so charts show gaps as zero instead of skipping them. */
export function fillBuckets(rows: Raw[], w: Window): TimeBucket[] {
  const size = w.bucketSeconds * 1000;
  const first = Math.floor(w.from / size) * size;
  const byT = new Map(rows.map((r) => [num(r.t), r]));
  const out: TimeBucket[] = [];
  for (let t = first; t < w.to; t += size) {
    const r = byT.get(t);
    out.push({
      t,
      requests: r ? num(r.requests) : 0,
      php: r ? num(r.php) : 0,
      db: r ? num(r.db) : 0,
      http: r ? num(r.http) : 0,
    });
  }
  return out;
}

export class Reports {
  constructor(private readonly ch: CH) {}

  async fleet(sites: SiteRecord[], w: Window): Promise<SiteSummary[]> {
    if (sites.length === 0) return [];
    const ids = sites.map((s) => s.id);
    const [stats, seen, spark, issues] = await Promise.all([
      run<Raw>(this.ch, Q.fleetStats(ids, w)),
      run<Raw>(this.ch, Q.fleetLastSeen(ids)),
      run<Raw>(this.ch, Q.fleetSpark(ids, w)),
      run<Raw>(this.ch, Q.fleetIssues(ids, w)),
    ]);
    const statsBy = new Map(stats.map((r) => [String(r.site_id), r]));
    const seenBy = new Map(seen.map((r) => [String(r.site_id), num(r.last_seen)]));
    const size = w.bucketSeconds * 1000;
    const first = Math.floor(w.from / size) * size;
    const buckets = Math.ceil((w.to - first) / size);
    return sites.map((s) => {
      const st = statsBy.get(s.id);
      const line = new Array<number>(buckets).fill(0);
      for (const r of spark) {
        if (r.site_id !== s.id) continue;
        const idx = Math.floor((num(r.t) - first) / size);
        if (idx >= 0 && idx < buckets) line[idx] = num(r.avg);
      }
      const sev = { high: 0, medium: 0, low: 0 };
      for (const r of issues) {
        if (r.site_id !== s.id) continue;
        const rank = num(r.sev);
        sev[rank === 3 ? "high" : rank === 2 ? "medium" : "low"] += num(r.n);
      }
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        keyHint: s.keyHint,
        createdAt: s.createdAt,
        requests: st ? num(st.requests) : 0,
        avg: st ? num(st.avg) : 0,
        p50: st ? q(st.q, 0) : 0,
        p95: st ? q(st.q, 1) : 0,
        errorRate: st ? num(st.error_rate) * 100 : 0,
        lastSeen: seenBy.get(s.id) || null,
        issues: sev,
        spark: line,
      };
    });
  }

  async siteInfo(site: SiteRecord): Promise<SiteInfo> {
    const [meta] = await run<Raw>(this.ch, Q.siteMeta(site.id));
    const has = meta && num(meta.n) > 0;
    return {
      id: site.id,
      name: site.name,
      url: site.url,
      keyHint: site.keyHint,
      createdAt: site.createdAt,
      lastSeen: has ? num(meta.last_seen) : null,
      phpVersion: has ? String(meta.php) : "",
      wpVersion: has ? String(meta.wp) : "",
      agentVersion: has ? String(meta.agent) : "",
    };
  }

  async transactions(siteId: string, w: Window, type: string): Promise<TransactionsResponse> {
    const [[sum], series, rows] = await Promise.all([
      run<Raw>(this.ch, Q.txnSummary(siteId, w, type)),
      run<Raw>(this.ch, Q.txnSeries(siteId, w, type)),
      run<Raw>(this.ch, Q.txnTable(siteId, w, type)),
    ]);
    const minutes = w.seconds / 60;
    const requests = sum ? num(sum.requests) : 0;
    const grand = rows.reduce((n, r) => n + num(r.total), 0);
    return {
      summary: {
        requests,
        avg: requests ? num(sum!.avg) : 0,
        p50: requests ? q(sum!.q, 0) : 0,
        p95: requests ? q(sum!.q, 1) : 0,
        p99: requests ? q(sum!.q, 2) : 0,
        errorRate: requests ? num(sum!.error_rate) * 100 : 0,
        avgQueries: requests ? num(sum!.avg_queries) : 0,
        ratePerMin: requests / minutes,
      },
      bucketSeconds: w.bucketSeconds,
      series: fillBuckets(series, w),
      rows: rows.map((r) => ({
        name: String(r.name),
        type: String(r.txn_type),
        count: num(r.count),
        total: num(r.total),
        share: share(num(r.total), grand),
        max: num(r.max),
        avg: num(r.avg),
        p50: q(r.q, 0),
        p95: q(r.q, 1),
        ratePerMin: num(r.count) / minutes,
        errors: num(r.errors),
      })),
    };
  }

  async wordpress(siteId: string, w: Window): Promise<WordPressResponse> {
    const [components, callbacks, loads] = await Promise.all([
      run<Raw>(this.ch, Q.componentTable(siteId, w)),
      run<Raw>(this.ch, Q.callbackTable(siteId, w)),
      run<Raw>(this.ch, Q.loadTable(siteId, w)),
    ]);
    const minutes = w.seconds / 60;
    const grand = components.reduce((n, r) => n + num(r.total), 0);
    return {
      components: components.map((r) => ({
        component: String(r.component),
        total: num(r.total),
        share: share(num(r.total), grand),
        max: num(r.max),
        avgPerRequest: num(r.requests) ? num(r.total) / num(r.requests) : 0,
        requests: num(r.requests),
        calls: num(r.calls),
        ratePerMin: num(r.requests) / minutes,
      })),
      callbacks: callbacks.map((r) => ({
        name: String(r.name),
        hook: String(r.hook),
        component: String(r.component),
        count: num(r.count),
        total: num(r.total),
        avg: num(r.avg),
        max: num(r.max),
      })),
      loads: loads.map((r) => ({
        name: String(r.name),
        kind: r.kind === "theme_load" ? "theme_load" : "plugin_load",
        component: String(r.component),
        avg: num(r.avg),
        max: num(r.max),
        count: num(r.count),
      })),
    };
  }

  async database(siteId: string, w: Window): Promise<DatabaseResponse> {
    const [queries, components] = await Promise.all([
      run<Raw>(this.ch, Q.queryTable(siteId, w)),
      run<Raw>(this.ch, Q.queryComponentTable(siteId, w)),
    ]);
    const grand = components.reduce((n, r) => n + num(r.total), 0);
    return {
      queries: queries.map((r) => ({
        hash: String(r.hash),
        fingerprint: String(r.fingerprint),
        component: String(r.component),
        count: num(r.count),
        total: num(r.total),
        share: share(num(r.total), grand),
        avg: num(r.avg),
        max: num(r.max),
      })),
      components: components.map((r) => ({
        component: String(r.component),
        count: num(r.count),
        total: num(r.total),
        share: share(num(r.total), grand),
        avg: num(r.avg),
      })),
    };
  }

  async external(siteId: string, w: Window): Promise<ExternalRow[]> {
    const rows = await run<Raw>(this.ch, Q.externalTable(siteId, w));
    const minutes = w.seconds / 60;
    const grand = rows.reduce((n, r) => n + num(r.total), 0);
    return rows.map((r) => ({
      host: String(r.host),
      method: String(r.method),
      count: num(r.count),
      total: num(r.total),
      share: share(num(r.total), grand),
      max: num(r.max),
      avg: num(r.avg),
      ratePerMin: num(r.count) / minutes,
      errors: num(r.errors),
    }));
  }

  async errors(siteId: string, w: Window): Promise<ErrorGroup[]> {
    const rows = await run<Raw>(this.ch, Q.errorTable(siteId, w));
    return rows.map((r) => ({
      fingerprint: String(r.fingerprint),
      level: String(r.level),
      message: String(r.message),
      file: String(r.file),
      line: num(r.line),
      component: String(r.component),
      count: num(r.count),
      firstSeen: num(r.first_seen),
      lastSeen: num(r.last_seen),
    }));
  }

  async issues(siteId: string, w: Window, f: Q.IssueFilters): Promise<IssuesResponse> {
    const [rows, [count], routes] = await Promise.all([
      run<Raw>(this.ch, Q.issueList(siteId, w, f)),
      run<Raw>(this.ch, Q.issueCount(siteId, w, f)),
      run<Raw>(this.ch, Q.issueRoutes(siteId, w)),
    ]);
    return {
      issues: rows.map(toIssueGroup),
      total: count ? num(count.total) : 0,
      page: f.page,
      pageSize: f.pageSize,
      routes: routes.map((r) => String(r.route)),
    };
  }

  async issue(siteId: string, fingerprint: string, w: Window): Promise<IssueDetail | null> {
    const [[row], recent] = await Promise.all([
      run<Raw>(this.ch, Q.issueDetail(siteId, fingerprint, w)),
      run<Raw>(this.ch, Q.issueRecent(siteId, fingerprint, w)),
    ]);
    if (!row) return null;
    const latest = recent[0];
    return {
      fingerprint: String(row.fingerprint),
      type: String(row.issue_type) as IssueType,
      severity: String(row.sev_name) as Severity,
      title: String(row.last_title),
      route: String(row.issue_route),
      subject: String(row.issue_subject),
      count: num(row.count),
      firstSeen: num(row.first_seen),
      lastSeen: num(row.last_seen),
      detail: String(row.last_detail),
      fix: String(row.last_fix),
      maxValue: num(row.max_value),
      sample: latest
        ? { transactionId: String(latest.transaction_id), ts: num(latest.ts_ms), url: String(latest.url) }
        : null,
      recent: recent.map((r) => ({ transactionId: String(r.transaction_id), ts: num(r.ts_ms), value: num(r.value) })),
    };
  }

  async samples(siteId: string, w: Window, by: SampleBy, key: string): Promise<SamplesResponse> {
    const base = Q.sampleBase(siteId, w, by, key);
    const [buckets, recent] = await Promise.all([run<Raw>(this.ch, Q.sampleHistogram(base)), run<Raw>(this.ch, Q.sampleRecent(base))]);
    const picked = pickSamples(buckets);
    const picks: { label: string; row: Raw }[] = [];
    if (by !== "error") {
      for (const [label, row] of [
        ["Slowest", picked.slowest],
        ["p95", picked.p95],
        ["p50", picked.p50],
      ] as const) {
        if (row) picks.push({ label, row });
      }
    }
    const recentRows: Raw[] = recent;
    const ids = [...new Set([...picks.map((p) => String(p.row.tid)), ...recentRows.map((r) => String(r.tid))])];
    const txns = ids.length ? await run<Raw>(this.ch, Q.transactionsByIds(siteId, ids, w)) : [];
    const byId = new Map(txns.map((t) => [String(t.id), t]));
    const toSample = (r: Raw): Sample | null => {
      const t = byId.get(String(r.tid));
      if (!t) return null;
      return {
        transactionId: String(t.id),
        ts: num(t.ts_ms),
        name: String(t.name),
        url: String(t.url),
        duration: num(t.duration),
        value: num(r.value),
        status: num(t.status),
      };
    };
    const highlights = picks
      .map((p) => ({ label: p.label, sample: toSample(p.row) }))
      .filter((h): h is { label: string; sample: Sample } => h.sample !== null);
    return {
      label: sampleLabel(by),
      highlights,
      recent: recentRows.map(toSample).filter((s): s is Sample => s !== null),
    };
  }

  async trace(siteId: string, id: string): Promise<Trace | null> {
    const [t] = await run<Raw>(this.ch, Q.traceTransaction(siteId, id));
    if (!t) return null;
    const ts = num(t.ts_ms);
    const [spans, errors, issues] = await Promise.all([
      run<Raw>(this.ch, Q.traceSpans(siteId, id, ts)),
      run<Raw>(this.ch, Q.traceErrors(siteId, id, ts)),
      run<Raw>(this.ch, Q.traceIssues(siteId, id, ts)),
    ]);
    return {
      id: String(t.id),
      ts,
      name: String(t.name),
      type: String(t.type),
      method: String(t.method),
      url: String(t.url),
      status: num(t.status),
      duration: num(t.duration),
      dbTime: num(t.db_time),
      dbCount: num(t.db_count),
      httpTime: num(t.http_time),
      httpCount: num(t.http_count),
      phpTime: num(t.php_time),
      memoryPeakMb: num(t.memory_peak_mb),
      memoryLimitMb: num(t.memory_limit_mb),
      phpVersion: String(t.php_version),
      wpVersion: String(t.wp_version),
      agentVersion: String(t.agent_version),
      userLoggedIn: num(t.user_logged_in) === 1,
      droppedSpans: num(t.dropped_spans),
      spans: spans.map(
        (s): TraceSpan => ({
          seq: num(s.seq),
          kind: String(s.kind) as TraceSpan["kind"],
          name: String(s.name),
          component: String(s.component),
          hook: String(s.hook),
          file: String(s.file),
          start: num(s.start),
          duration: num(s.duration),
          self: num(s.self_time),
          sql: String(s.sql),
          fingerprint: String(s.fingerprint),
          rows: num(s.rows),
          url: String(s.url),
          host: String(s.host),
          method: String(s.method),
          status: num(s.status),
          error: String(s.error),
          stack: Array.isArray(s.stack) ? s.stack.map(String) : [],
        }),
      ),
      errors: errors.map((e) => ({
        level: String(e.level),
        message: String(e.message),
        file: String(e.file),
        line: num(e.line),
        component: String(e.component),
      })),
      issues: issues.map((i) => ({
        type: String(i.type) as IssueType,
        severity: String(i.severity) as Severity,
        title: String(i.title),
        fingerprint: String(i.fingerprint),
      })),
    };
  }
}

export interface SampleRow extends Raw {
  tid: string;
  ts_ms: number;
  value: number;
}

const sampleRow = (t: unknown): SampleRow | null =>
  Array.isArray(t) && t.length === 3 ? { tid: String(t[0]), ts_ms: num(t[1]), value: num(t[2]) } : null;

/**
 * Picks the panel rows from value buckets (see Q.sampleHistogram): the slowest row, and the newest row of the
 * buckets that hold p95 and p50, which is within one bucket (about 5%) of the exact quantile.
 */
export function pickSamples(buckets: Raw[]) {
  const sorted = [...buckets].sort((a, b) => num(a.bucket) - num(b.bucket));
  const n = sorted.reduce((sum, b) => sum + num(b.n), 0);
  const atQuantile = (q: number): SampleRow | null => {
    const k = Math.max(1, Math.ceil(q * n));
    let seen = 0;
    for (const b of sorted) {
      seen += num(b.n);
      if (seen >= k) return sampleRow(b.newest);
    }
    return null;
  };
  const last = sorted.at(-1);
  return {
    n,
    slowest: last ? sampleRow(last.top) : null,
    p95: n > 0 ? atQuantile(0.95) : null,
    p50: n > 0 ? atQuantile(0.5) : null,
  };
}

function toIssueGroup(r: Raw): IssueGroup {
  return {
    fingerprint: String(r.fingerprint),
    type: String(r.type) as IssueType,
    severity: String(r.severity) as Severity,
    title: String(r.title),
    route: String(r.route),
    subject: String(r.subject),
    count: num(r.count),
    firstSeen: num(r.first_seen),
    lastSeen: num(r.last_seen),
  };
}

function sampleLabel(by: SampleBy): string {
  switch (by) {
    case "transaction":
      return "Duration";
    case "component":
      return "Self time";
    case "callback":
      return "Callback time";
    case "query":
      return "Query time";
    case "external":
      return "Request time";
    case "error":
      return "Occurrences";
  }
}
