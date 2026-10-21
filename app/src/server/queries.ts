import type { Window } from "../shared/range";
import type { SampleBy, Severity } from "../shared/types";

export interface Q {
  query: string;
  params: Record<string, unknown>;
}

const RANGE = `site_id = {site:String}
  AND ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
  AND ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')`;

const windowParams = (site: string, w: Window) => ({ site, from: w.from, to: w.to });

/** Requests estimated from sampled transactions: each stored transaction stands for 1 / sample_rate requests. */
export const EST_REQUESTS_SQL = "toUInt64(round(sum(1 / if(sample_rate > 0 AND sample_rate <= 1, sample_rate, 1))))";

export const SEVERITY_RANK_SQL = "multiIf(severity = 'high', 3, severity = 'medium', 2, 1)";

export function fleetStats(siteIds: string[], w: Window): Q {
  return {
    query: `SELECT site_id, ${EST_REQUESTS_SQL} AS requests, avg(duration) AS avg,
        quantilesTDigest(0.5, 0.95)(duration) AS q, avg(is_error) AS error_rate
      FROM transactions
      WHERE site_id IN {sites:Array(String)}
        AND ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
        AND ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
      GROUP BY site_id`,
    params: { sites: siteIds, from: w.from, to: w.to },
  };
}

export function fleetLastSeen(siteIds: string[]): Q {
  return {
    query: `SELECT site_id, toUnixTimestamp64Milli(max(ts)) AS last_seen
      FROM transactions WHERE site_id IN {sites:Array(String)} GROUP BY site_id`,
    params: { sites: siteIds },
  };
}

export function fleetSpark(siteIds: string[], w: Window): Q {
  return {
    query: `SELECT site_id, toUnixTimestamp(toStartOfInterval(ts, toIntervalSecond({bucket:UInt32}))) * 1000 AS t,
        avg(duration) AS avg
      FROM transactions
      WHERE site_id IN {sites:Array(String)}
        AND ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
        AND ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
      GROUP BY site_id, t ORDER BY site_id, t`,
    params: { sites: siteIds, from: w.from, to: w.to, bucket: w.bucketSeconds },
  };
}

export function fleetIssues(siteIds: string[], w: Window): Q {
  return {
    query: `SELECT site_id, sev, count() AS n FROM (
        SELECT site_id, fingerprint, max(${SEVERITY_RANK_SQL}) AS sev
        FROM issue_events
        WHERE site_id IN {sites:Array(String)}
          AND ts >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
          AND ts < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
        GROUP BY site_id, fingerprint
      ) GROUP BY site_id, sev`,
    params: { sites: siteIds, from: w.from, to: w.to },
  };
}

export function siteMeta(site: string): Q {
  return {
    query: `SELECT toUnixTimestamp64Milli(max(ts)) AS last_seen, argMax(php_version, ts) AS php,
        argMax(wp_version, ts) AS wp, argMax(agent_version, ts) AS agent, count() AS n
      FROM transactions WHERE site_id = {site:String}`,
    params: { site },
  };
}

const typeFilter = "AND ({type:String} = '' OR type = {type:String})";

export function txnSummary(site: string, w: Window, type: string): Q {
  return {
    query: `SELECT ${EST_REQUESTS_SQL} AS requests, avg(duration) AS avg,
        quantilesTDigest(0.5, 0.95, 0.99)(duration) AS q,
        avg(is_error) AS error_rate, avg(db_count) AS avg_queries
      FROM transactions WHERE ${RANGE} ${typeFilter}`,
    params: { ...windowParams(site, w), type },
  };
}

export function txnSeries(site: string, w: Window, type: string): Q {
  return {
    query: `SELECT toUnixTimestamp(toStartOfInterval(ts, toIntervalSecond({bucket:UInt32}))) * 1000 AS t,
        ${EST_REQUESTS_SQL} AS requests, avg(php_time) AS php, avg(db_time) AS db, avg(http_time) AS http
      FROM transactions WHERE ${RANGE} ${typeFilter}
      GROUP BY t ORDER BY t`,
    params: { ...windowParams(site, w), type, bucket: w.bucketSeconds },
  };
}

export function txnTable(site: string, w: Window, type: string): Q {
  return {
    query: `SELECT name, any(type) AS txn_type, ${EST_REQUESTS_SQL} AS count, sum(duration / if(sample_rate > 0 AND sample_rate <= 1, sample_rate, 1)) AS total, max(duration) AS max,
        avg(duration) AS avg, quantilesTDigest(0.5, 0.95)(duration) AS q, countIf(is_error = 1) AS errors
      FROM transactions WHERE ${RANGE} ${typeFilter}
      GROUP BY name ORDER BY total DESC LIMIT 500`,
    params: { ...windowParams(site, w), type },
  };
}

export function componentTable(site: string, w: Window): Q {
  return {
    query: `SELECT component, sum(time) AS total, max(time) AS max, count() AS requests, sum(calls) AS calls
      FROM transactions ARRAY JOIN comp_names AS component, comp_times AS time, comp_calls AS calls
      WHERE ${RANGE}
      GROUP BY component ORDER BY total DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

export function callbackTable(site: string, w: Window): Q {
  return {
    query: `SELECT name, hook, component, count() AS count, sum(duration) AS total, avg(duration) AS avg,
        max(duration) AS max
      FROM spans WHERE ${RANGE} AND kind = 'callback'
      GROUP BY name, hook, component ORDER BY total DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

export function loadTable(site: string, w: Window): Q {
  return {
    query: `SELECT name, kind, any(component) AS component, avg(duration) AS avg, max(duration) AS max, count() AS count
      FROM spans WHERE ${RANGE} AND kind IN ('plugin_load', 'theme_load')
      GROUP BY name, kind ORDER BY avg DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

/**
 * Aggregates by the fingerprint hash only, then joins the text from the small query_fingerprints table for the
 * top rows. Reading the fingerprint column of every span in the range is what made this report slow.
 */
export function queryTable(site: string, w: Window): Q {
  return {
    query: `SELECT toString(t.fp_hash) AS hash, f.fingerprint AS fingerprint, t.component AS component,
        t.count AS count, t.total AS total, t.avg AS avg, t.max AS max
      FROM (
        SELECT fp_hash, topK(1)(component)[1] AS component, count() AS count, sum(duration) AS total,
          avg(duration) AS avg, max(duration) AS max
        FROM spans WHERE ${RANGE} AND kind = 'db'
        GROUP BY fp_hash ORDER BY total DESC LIMIT 500
      ) AS t
      LEFT JOIN (
        SELECT fp_hash, any(fingerprint) AS fingerprint FROM query_fingerprints
        WHERE site_id = {site:String} GROUP BY fp_hash
      ) AS f ON f.fp_hash = t.fp_hash
      ORDER BY total DESC`,
    params: windowParams(site, w),
  };
}

export function queryComponentTable(site: string, w: Window): Q {
  return {
    query: `SELECT component, count() AS count, sum(duration) AS total, avg(duration) AS avg
      FROM spans WHERE ${RANGE} AND kind = 'db'
      GROUP BY component ORDER BY total DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

export function externalTable(site: string, w: Window): Q {
  return {
    query: `SELECT host, method, count() AS count, sum(duration) AS total, max(duration) AS max, avg(duration) AS avg,
        countIf(error != '' OR status >= 500) AS errors
      FROM spans WHERE ${RANGE} AND kind = 'http'
      GROUP BY host, method ORDER BY total DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

export function errorTable(site: string, w: Window): Q {
  return {
    query: `SELECT fingerprint, any(level) AS level, any(message) AS message, any(file) AS file, any(line) AS line,
        any(component) AS component, count() AS count,
        toUnixTimestamp64Milli(min(ts)) AS first_seen, toUnixTimestamp64Milli(max(ts)) AS last_seen
      FROM errors WHERE ${RANGE}
      GROUP BY fingerprint ORDER BY count DESC LIMIT 500`,
    params: windowParams(site, w),
  };
}

export interface IssueFilters {
  severity: Severity | "";
  type: string;
  route: string;
  page: number;
  pageSize: number;
}

const SEV_NAME = "multiIf(sev = 3, 'high', sev = 2, 'medium', 'low')";

function issueGroups(): string {
  return `SELECT fingerprint, any(type) AS issue_type, max(${SEVERITY_RANK_SQL}) AS sev, any(title) AS title,
      any(route) AS issue_route, any(subject) AS subject, count() AS count,
      toUnixTimestamp64Milli(min(ts)) AS first_seen, toUnixTimestamp64Milli(max(ts)) AS last_seen
    FROM issue_events
    WHERE ${RANGE}
      AND ({type:String} = '' OR type = {type:String})
      AND ({route:String} = '' OR route = {route:String})
    GROUP BY fingerprint
    HAVING {severity:String} = '' OR ${SEV_NAME} = {severity:String}`;
}

export function issueList(site: string, w: Window, f: IssueFilters): Q {
  return {
    query: `SELECT fingerprint, issue_type AS type, ${SEV_NAME} AS severity, title, issue_route AS route, subject, count, first_seen, last_seen
      FROM (${issueGroups()})
      ORDER BY sev DESC, last_seen DESC, fingerprint
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    params: {
      ...windowParams(site, w),
      type: f.type,
      route: f.route,
      severity: f.severity,
      limit: f.pageSize,
      offset: (f.page - 1) * f.pageSize,
    },
  };
}

export function issueCount(site: string, w: Window, f: IssueFilters): Q {
  return {
    query: `SELECT count() AS total FROM (${issueGroups()})`,
    params: { ...windowParams(site, w), type: f.type, route: f.route, severity: f.severity },
  };
}

export function issueRoutes(site: string, w: Window): Q {
  return {
    query: `SELECT DISTINCT route FROM issue_events WHERE ${RANGE} ORDER BY route LIMIT 200`,
    params: windowParams(site, w),
  };
}

export function issueDetail(site: string, fingerprint: string, w: Window): Q {
  return {
    query: `SELECT fingerprint, any(type) AS issue_type,
        multiIf(max(${SEVERITY_RANK_SQL}) = 3, 'high', max(${SEVERITY_RANK_SQL}) = 2, 'medium', 'low') AS sev_name,
        argMax(title, ts) AS last_title, any(route) AS issue_route, any(subject) AS issue_subject, count() AS count,
        toUnixTimestamp64Milli(min(ts)) AS first_seen, toUnixTimestamp64Milli(max(ts)) AS last_seen,
        argMax(detail, ts) AS last_detail, argMax(fix, ts) AS last_fix, max(value) AS max_value
      FROM issue_events WHERE ${RANGE} AND fingerprint = {fp:String}
      GROUP BY fingerprint`,
    params: { ...windowParams(site, w), fp: fingerprint },
  };
}

export function issueRecent(site: string, fingerprint: string, w: Window): Q {
  return {
    query: `SELECT transaction_id, toUnixTimestamp64Milli(ts) AS ts_ms, value, url
      FROM issue_events WHERE ${RANGE} AND fingerprint = {fp:String}
      ORDER BY ts DESC LIMIT 20`,
    params: { ...windowParams(site, w), fp: fingerprint },
  };
}

/**
 * Per-transaction values for a samples panel: one row per transaction with the
 * value that matters for the clicked entity (duration, self time, query time).
 * Spans and errors carry their transaction's timestamp, so grouping by (ts, transaction_id) follows the sort
 * key and can aggregate in order, with far less memory than a hash table of every transaction id.
 */
export function sampleBase(site: string, w: Window, by: SampleBy, key: string): Q {
  const params: Record<string, unknown> = { ...windowParams(site, w), key };
  let base: string;
  switch (by) {
    case "transaction":
      base = `SELECT id AS tid, ts AS sts, duration AS value FROM transactions WHERE ${RANGE} AND name = {key:String}`;
      break;
    case "component":
      base = `SELECT id AS tid, ts AS sts, time AS value
        FROM transactions ARRAY JOIN comp_names AS component, comp_times AS time
        WHERE ${RANGE} AND component = {key:String}`;
      break;
    case "callback": {
      const [name, hook, component] = parseCallbackKey(key);
      Object.assign(params, { name, hook, component });
      base = `SELECT transaction_id AS tid, ts AS sts, sum(duration) AS value FROM spans
        WHERE ${RANGE} AND kind = 'callback' AND name = {name:String} AND hook = {hook:String} AND component = {component:String}
        GROUP BY ts, transaction_id
        SETTINGS optimize_aggregation_in_order = 1`;
      break;
    }
    case "query":
      base = `SELECT transaction_id AS tid, ts AS sts, sum(duration) AS value FROM spans
        WHERE ${RANGE} AND kind = 'db' AND fp_hash = toUInt64OrZero({key:String})
        GROUP BY ts, transaction_id
        SETTINGS optimize_aggregation_in_order = 1`;
      break;
    case "external": {
      const space = key.indexOf(" ");
      Object.assign(params, { method: key.slice(0, space), host: key.slice(space + 1) });
      base = `SELECT transaction_id AS tid, ts AS sts, sum(duration) AS value FROM spans
        WHERE ${RANGE} AND kind = 'http' AND method = {method:String} AND host = {host:String}
        GROUP BY ts, transaction_id
        SETTINGS optimize_aggregation_in_order = 1`;
      break;
    }
    case "error":
      base = `SELECT transaction_id AS tid, ts AS sts, toFloat64(count()) AS value FROM errors
        WHERE ${RANGE} AND fingerprint = {key:String}
        GROUP BY ts, transaction_id
        SETTINGS optimize_aggregation_in_order = 1`;
      break;
  }
  return { query: base, params };
}

export function parseCallbackKey(key: string): [string, string, string] {
  try {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((p) => typeof p === "string")) {
      return parsed as [string, string, string];
    }
  } catch {
    // fall through to the empty key, which matches nothing
  }
  return ["", "", ""];
}

/** Buckets per factor e of the value, so one bucket spans about 5% (e^(1/20)). */
export const SAMPLE_BUCKETS_PER_E = 20;

/**
 * Rows of a sample base grouped into value buckets of about 5% width, with the row count, the slowest row and
 * the newest row of each bucket. The slowest overall and rows near p95 and p50 are picked from these few
 * hundred rows in the app, so one scan replaces a quantile query plus one query per pick.
 */
export function sampleHistogram(base: Q): Q {
  return {
    query: `WITH base AS (${base.query})
      SELECT if(value > 0, toInt32(floor(log(value) * ${SAMPLE_BUCKETS_PER_E})), -1000000) AS bucket, count() AS n,
        argMax((tid, toUnixTimestamp64Milli(sts), value), (value, toUnixTimestamp64Milli(sts))) AS top,
        argMax((tid, toUnixTimestamp64Milli(sts), value), toUnixTimestamp64Milli(sts)) AS newest
      FROM base
      GROUP BY bucket ORDER BY bucket`,
    params: base.params,
  };
}

/** The newest rows of a sample base. It runs next to sampleHistogram, in parallel. */
export function sampleRecent(base: Q, limit = 20): Q {
  return {
    query: `WITH base AS (${base.query})
      SELECT tid, toUnixTimestamp64Milli(sts) AS ts_ms, value FROM base ORDER BY sts DESC LIMIT {limit:UInt32}`,
    params: { ...base.params, limit },
  };
}

export function transactionsByIds(site: string, ids: string[], w: Window): Q {
  return {
    query: `SELECT id, toUnixTimestamp64Milli(ts) AS ts_ms, name, url, duration, status
      FROM transactions WHERE ${RANGE} AND id IN {ids:Array(String)}`,
    params: { ...windowParams(site, w), ids },
  };
}

export function traceTransaction(site: string, id: string): Q {
  return {
    query: `SELECT id, toUnixTimestamp64Milli(ts) AS ts_ms, name, type, method, url, status, duration, db_time, db_count,
        http_time, http_count, php_time, memory_peak_mb, memory_limit_mb, php_version, wp_version, agent_version,
        user_logged_in, dropped_spans
      FROM transactions WHERE site_id = {site:String} AND id = {id:String} LIMIT 1`,
    params: { site, id },
  };
}

const AT_TS = "site_id = {site:String} AND ts = fromUnixTimestamp64Milli({ts:Int64}, 'UTC') AND transaction_id = {id:String}";

export function traceSpans(site: string, id: string, ts: number): Q {
  return {
    query: `SELECT seq, kind, name, component, hook, file, start, duration, self_time, sql, fingerprint, rows,
        url, host, method, status, error, stack
      FROM spans WHERE ${AT_TS} ORDER BY start, seq`,
    params: { site, id, ts },
  };
}

export function traceErrors(site: string, id: string, ts: number): Q {
  return {
    query: `SELECT level, message, file, line, component FROM errors WHERE ${AT_TS}`,
    params: { site, id, ts },
  };
}

export function traceIssues(site: string, id: string, ts: number): Q {
  return {
    query: `SELECT type, severity, title, fingerprint FROM issue_events WHERE ${AT_TS}
      ORDER BY ${SEVERITY_RANK_SQL} DESC`,
    params: { site, id, ts },
  };
}
