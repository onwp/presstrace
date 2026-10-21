import type { CH } from "./db";
import { queryRows } from "./db";

export interface Retention {
  transactionsTtlDays: number;
  spansTtlDays: number;
}

interface Migration {
  version: number;
  name: string;
  statements: (r: Retention) => string[];
}

const ttl = (days: number) => `TTL toDateTime(ts) + toIntervalDay(${Math.trunc(days)})`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    statements: (r) => [
      `CREATE TABLE IF NOT EXISTS sites (
        id String,
        name String,
        url String,
        key_hash String,
        key_hint String,
        created_at DateTime64(3, 'UTC'),
        updated_at DateTime64(3, 'UTC'),
        deleted UInt8 DEFAULT 0
      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY id`,

      `CREATE TABLE IF NOT EXISTS transactions (
        site_id LowCardinality(String),
        id String,
        ts DateTime64(3, 'UTC'),
        received_at DateTime64(3, 'UTC') DEFAULT now64(3),
        name LowCardinality(String),
        type LowCardinality(String),
        method LowCardinality(String),
        url String,
        status UInt16,
        duration Float64,
        db_time Float64,
        db_count UInt32,
        http_time Float64,
        http_count UInt32,
        php_time Float64,
        memory_peak_mb Float32,
        memory_limit_mb Int32,
        sample_rate Float32,
        user_logged_in UInt8,
        is_error UInt8,
        error_count UInt16,
        span_count UInt16,
        dropped_spans UInt32,
        php_version LowCardinality(String),
        wp_version LowCardinality(String),
        agent_version LowCardinality(String),
        object_cache UInt8,
        db_capture LowCardinality(String),
        comp_names Array(LowCardinality(String)),
        comp_times Array(Float64),
        comp_calls Array(UInt32),
        INDEX idx_id id TYPE bloom_filter(0.01) GRANULARITY 4
      ) ENGINE = MergeTree
      PARTITION BY toDate(ts)
      ORDER BY (site_id, ts)
      ${ttl(r.transactionsTtlDays)}
      SETTINGS ttl_only_drop_parts = 1`,

      `CREATE TABLE IF NOT EXISTS spans (
        site_id LowCardinality(String),
        ts DateTime64(3, 'UTC'),
        transaction_id String,
        transaction_name LowCardinality(String),
        seq UInt16,
        kind LowCardinality(String),
        name String,
        component LowCardinality(String),
        hook LowCardinality(String),
        file String,
        start Float64,
        duration Float64,
        self_time Float64,
        sql String,
        fingerprint String,
        fp_hash UInt64 MATERIALIZED if(fingerprint = '', 0, cityHash64(fingerprint)),
        rows Int64,
        url String,
        host LowCardinality(String),
        method LowCardinality(String),
        status UInt16,
        error String,
        stack Array(String),
        INDEX idx_txn transaction_id TYPE bloom_filter(0.01) GRANULARITY 4
      ) ENGINE = MergeTree
      PARTITION BY toDate(ts)
      ORDER BY (site_id, kind, ts, transaction_id)
      ${ttl(r.spansTtlDays)}
      SETTINGS ttl_only_drop_parts = 1`,

      `CREATE TABLE IF NOT EXISTS issue_events (
        site_id LowCardinality(String),
        ts DateTime64(3, 'UTC'),
        transaction_id String,
        url String,
        type LowCardinality(String),
        severity LowCardinality(String),
        fingerprint String,
        route LowCardinality(String),
        subject String,
        title String,
        detail String,
        fix String,
        value Float64
      ) ENGINE = MergeTree
      PARTITION BY toDate(ts)
      ORDER BY (site_id, ts)
      ${ttl(r.transactionsTtlDays)}
      SETTINGS ttl_only_drop_parts = 1`,

      `CREATE TABLE IF NOT EXISTS errors (
        site_id LowCardinality(String),
        ts DateTime64(3, 'UTC'),
        transaction_id String,
        transaction_name LowCardinality(String),
        url String,
        level LowCardinality(String),
        message String,
        file String,
        line UInt32,
        component LowCardinality(String),
        fingerprint String
      ) ENGINE = MergeTree
      PARTITION BY toDate(ts)
      ORDER BY (site_id, ts)
      ${ttl(r.transactionsTtlDays)}
      SETTINGS ttl_only_drop_parts = 1`,
    ],
  },
  {
    version: 2,
    name: "query fingerprints, revoked sessions, insert deduplication, cheaper TTL changes",
    statements: (r) => [
      // With ttl_only_drop_parts, a TTL change only needs the per-part TTL info recalculated, not every row
      // rewritten, so retention changes stay cheap on big tables. The deduplication window lets a retried
      // batch (same insert_deduplication_token) be stored once even if an earlier attempt went through.
      ...["transactions", "spans", "issue_events", "errors"].map(
        (t) => `ALTER TABLE ${t} MODIFY SETTING materialize_ttl_recalculate_only = 1, non_replicated_deduplication_window = 1000`,
      ),

      // One row per (site, query fingerprint): the database report reads the text from here instead of
      // scanning the fingerprint column of every span.
      `CREATE TABLE IF NOT EXISTS query_fingerprints (
        site_id LowCardinality(String),
        fp_hash UInt64,
        fingerprint String,
        ts DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(ts)
      ORDER BY (site_id, fp_hash)
      ${ttl(r.spansTtlDays)}
      SETTINGS materialize_ttl_recalculate_only = 1`,

      `CREATE MATERIALIZED VIEW IF NOT EXISTS query_fingerprints_mv TO query_fingerprints AS
      SELECT site_id, fp_hash, any(fp_text) AS fingerprint, max(span_ts) AS ts
      FROM (
        SELECT site_id, cityHash64(fingerprint) AS fp_hash, fingerprint AS fp_text, ts AS span_ts
        FROM spans WHERE kind = 'db' AND fingerprint != ''
      )
      GROUP BY site_id, fp_hash`,

      // Backfill from spans stored before the view existed. Running it twice only adds duplicates that
      // ReplacingMergeTree folds away.
      `INSERT INTO query_fingerprints
      SELECT site_id, fp_hash, any(fingerprint), max(ts) FROM spans
      WHERE kind = 'db' AND fingerprint != ''
      GROUP BY site_id, fp_hash
      SETTINGS max_execution_time = 0`,

      `CREATE TABLE IF NOT EXISTS revoked_sessions (
        sid String,
        expires_at DateTime('UTC')
      ) ENGINE = ReplacingMergeTree
      ORDER BY sid
      TTL expires_at`,
    ],
  },
];

/** Which retention setting each time-series table follows. */
export const TTL_TABLES: Record<string, keyof Retention> = {
  transactions: "transactionsTtlDays",
  issue_events: "transactionsTtlDays",
  errors: "transactionsTtlDays",
  spans: "spansTtlDays",
  query_fingerprints: "spansTtlDays",
};

export async function migrate(ch: CH, retention: Retention, log: (msg: string) => void = () => {}): Promise<number[]> {
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS schema_migrations (
      version UInt32,
      name String,
      applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY version`,
  });
  const done = new Set(
    (await queryRows<{ version: number }>(ch, "SELECT version FROM schema_migrations")).map((r) => Number(r.version)),
  );
  const applied: number[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    for (const statement of m.statements(retention)) {
      await ch.command({ query: statement });
    }
    await ch.insert({
      table: "schema_migrations",
      values: [{ version: m.version, name: m.name }],
      format: "JSONEachRow",
    });
    applied.push(m.version);
    log(`Applied migration ${m.version}: ${m.name}`);
  }
  await applyRetention(ch, retention, log);
  return applied;
}

/** Reads the TTL day count from a table's engine definition, or null when it has none. */
export function parseTtlDays(engineFull: string): number | null {
  const match = /TTL\s+toDateTime\(ts\)\s*\+\s*toIntervalDay\((\d+)\)/.exec(engineFull);
  return match ? Number(match[1]) : null;
}

export async function applyRetention(ch: CH, retention: Retention, log: (msg: string) => void = () => {}): Promise<void> {
  const rows = await queryRows<{ name: string; engine_full: string }>(
    ch,
    "SELECT name, engine_full FROM system.tables WHERE database = currentDatabase() AND name IN {names:Array(String)}",
    { names: Object.keys(TTL_TABLES) },
  );
  for (const row of rows) {
    const key = TTL_TABLES[row.name];
    if (!key) continue;
    const wanted = retention[key];
    if (parseTtlDays(row.engine_full) === wanted) continue;
    await ch.command({ query: `ALTER TABLE ${row.name} MODIFY ${ttl(wanted)}` });
    log(`Retention for ${row.name} set to ${wanted} days`);
  }
}
