export const RANGES = ["30m", "1h", "2h", "4h", "12h", "24h", "7d"] as const;
export type RangeKey = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeKey = "1h";

const RANGE_SECONDS: Record<RangeKey, number> = {
  "30m": 30 * 60,
  "1h": 3600,
  "2h": 2 * 3600,
  "4h": 4 * 3600,
  "12h": 12 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
};

/** Bucket sizes chosen to give 30 to 60 bars per chart. */
const BUCKET_SECONDS: Record<RangeKey, number> = {
  "30m": 60,
  "1h": 120,
  "2h": 240,
  "4h": 480,
  "12h": 1200,
  "24h": 1800,
  "7d": 4 * 3600,
};

export const RANGE_LABELS: Record<RangeKey, string> = {
  "30m": "Last 30 minutes",
  "1h": "Last hour",
  "2h": "Last 2 hours",
  "4h": "Last 4 hours",
  "12h": "Last 12 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

export function isRange(value: unknown): value is RangeKey {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

export function parseRange(value: unknown): RangeKey {
  return isRange(value) ? value : DEFAULT_RANGE;
}

export interface Window {
  from: number;
  to: number;
  seconds: number;
  bucketSeconds: number;
}

/** Resolves a range to an absolute window ending now, aligned to whole buckets. */
export function rangeWindow(range: RangeKey, now: number = Date.now()): Window {
  const seconds = RANGE_SECONDS[range];
  const bucketSeconds = BUCKET_SECONDS[range];
  const to = now;
  const from = to - seconds * 1000;
  return { from, to, seconds, bucketSeconds };
}
