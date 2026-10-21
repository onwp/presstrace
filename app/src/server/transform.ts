import { detectIssues, errorFingerprint, type DetectSpan } from "./detect";
import { fingerprintSql } from "./fingerprint";
import { SQL_MAX_CHARS, type Payload } from "./payload";

export interface TransactionRow {
  site_id: string;
  id: string;
  ts: string;
  name: string;
  type: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  db_time: number;
  db_count: number;
  http_time: number;
  http_count: number;
  php_time: number;
  memory_peak_mb: number;
  memory_limit_mb: number;
  sample_rate: number;
  user_logged_in: number;
  is_error: number;
  error_count: number;
  span_count: number;
  dropped_spans: number;
  php_version: string;
  wp_version: string;
  agent_version: string;
  object_cache: number;
  db_capture: string;
  comp_names: string[];
  comp_times: number[];
  comp_calls: number[];
}

export interface SpanRow {
  site_id: string;
  ts: string;
  transaction_id: string;
  transaction_name: string;
  seq: number;
  kind: string;
  name: string;
  component: string;
  hook: string;
  file: string;
  start: number;
  duration: number;
  self_time: number;
  sql: string;
  fingerprint: string;
  rows: number;
  url: string;
  host: string;
  method: string;
  status: number;
  error: string;
  stack: string[];
}

export interface IssueRow {
  site_id: string;
  ts: string;
  transaction_id: string;
  url: string;
  type: string;
  severity: string;
  fingerprint: string;
  route: string;
  subject: string;
  title: string;
  detail: string;
  fix: string;
  value: number;
}

export interface ErrorRow {
  site_id: string;
  ts: string;
  transaction_id: string;
  transaction_name: string;
  url: string;
  level: string;
  message: string;
  file: string;
  line: number;
  component: string;
  fingerprint: string;
}

export interface Rows {
  transactions: TransactionRow[];
  spans: SpanRow[];
  issues: IssueRow[];
  errors: ErrorRow[];
}

/** ClickHouse DateTime64(3) literal in UTC. */
export function chTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** Removes credentials, query string and fragment from a URL. Non-URLs are returned without a query string. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw.split(/[?#]/)[0] ?? "";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function payloadToRows(siteId: string, payload: Payload): Rows {
  const rows: Rows = { transactions: [], spans: [], issues: [], errors: [] };
  const env = payload.env;

  for (const t of payload.transactions) {
    const ts = chTimestamp(t.ts);
    const url = sanitizeUrl(t.url);
    const method = t.method.toUpperCase();
    const hasFatal = t.errors.some((e) => e.level === "fatal" || e.level === "exception" || e.level === "error");
    const phpTime = Math.max(0, t.duration - t.db_time - t.http_time);
    const detectSpans: DetectSpan[] = [];

    t.spans.forEach((s, seq) => {
      const row: SpanRow = {
        site_id: siteId,
        ts,
        transaction_id: t.id,
        transaction_name: t.name,
        seq,
        kind: s.kind,
        name: s.name,
        component: s.component,
        hook: "",
        file: "",
        start: round3(s.start),
        duration: round3(s.duration),
        self_time: 0,
        sql: "",
        fingerprint: "",
        rows: -1,
        url: "",
        host: "",
        method: "",
        status: 0,
        error: "",
        stack: [],
      };
      const detect: DetectSpan = { kind: s.kind, name: s.name, duration: s.duration, component: s.component };
      switch (s.kind) {
        case "db": {
          row.sql = s.sql.slice(0, SQL_MAX_CHARS);
          row.fingerprint = fingerprintSql(row.sql);
          row.rows = s.rows ?? -1;
          row.error = s.error ?? "";
          row.stack = s.stack ?? [];
          detect.sql = row.sql;
          detect.fingerprint = row.fingerprint;
          detect.error = s.error ?? null;
          break;
        }
        case "http": {
          row.url = sanitizeUrl(s.url);
          row.host = hostOf(row.url) || s.name.split(" ")[0] || "";
          row.method = s.method.toUpperCase();
          row.status = s.status ?? 0;
          row.error = s.error ?? "";
          row.stack = s.stack ?? [];
          detect.host = row.host;
          detect.method = row.method;
          detect.status = s.status ?? null;
          detect.error = s.error ?? null;
          break;
        }
        case "callback": {
          row.hook = s.hook;
          row.file = s.file ?? "";
          row.self_time = round3(s.self ?? s.duration);
          break;
        }
        default:
          break;
      }
      rows.spans.push(row);
      detectSpans.push(detect);
    });

    const errors = t.errors.map((e) => ({
      level: e.level,
      message: e.message,
      file: e.file ?? "",
      line: e.line ?? 0,
      component: e.component,
    }));
    for (const e of errors) {
      rows.errors.push({
        site_id: siteId,
        ts,
        transaction_id: t.id,
        transaction_name: t.name,
        url,
        level: e.level,
        message: e.message,
        file: e.file,
        line: e.line,
        component: e.component,
        fingerprint: errorFingerprint(e.level, e.message, e.file, e.line),
      });
    }

    rows.transactions.push({
      site_id: siteId,
      id: t.id.toLowerCase(),
      ts,
      name: t.name,
      type: t.type,
      method,
      url,
      status: t.status,
      duration: round3(t.duration),
      db_time: round3(t.db_time),
      db_count: t.db_count,
      http_time: round3(t.http_time),
      http_count: t.http_count,
      php_time: round3(phpTime),
      memory_peak_mb: t.memory_peak_mb,
      memory_limit_mb: env.memory_limit_mb,
      sample_rate: t.sample_rate,
      user_logged_in: t.user_logged_in ? 1 : 0,
      is_error: t.status >= 500 || hasFatal ? 1 : 0,
      error_count: Math.min(65535, t.errors.length),
      span_count: t.spans.length,
      dropped_spans: t.dropped_spans,
      php_version: env.php,
      wp_version: env.wp,
      agent_version: payload.agent,
      object_cache: env.object_cache ? 1 : 0,
      db_capture: env.db_capture,
      comp_names: t.components.map((c) => c.component),
      comp_times: t.components.map((c) => round3(c.time)),
      comp_calls: t.components.map((c) => c.calls),
    });

    const issues = detectIssues({
      name: t.name,
      duration: t.duration,
      dbTime: t.db_time,
      dbCount: t.db_count,
      httpTime: t.http_time,
      memoryPeakMb: t.memory_peak_mb,
      memoryLimitMb: env.memory_limit_mb,
      spans: detectSpans,
      components: t.components,
      errors,
    });
    for (const issue of issues) {
      rows.issues.push({ site_id: siteId, ts, transaction_id: t.id.toLowerCase(), url, ...issue });
    }
  }
  // Span transaction ids are stored lower-case like the transaction row.
  for (const s of rows.spans) s.transaction_id = s.transaction_id.toLowerCase();
  for (const e of rows.errors) e.transaction_id = e.transaction_id.toLowerCase();
  return rows;
}
