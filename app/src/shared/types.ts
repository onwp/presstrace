export type Severity = "low" | "medium" | "high";

export type IssueType =
  | "n_plus_one"
  | "duplicate_query"
  | "too_many_queries"
  | "slow_query"
  | "select_star"
  | "slow_external"
  | "failed_external"
  | "slow_transaction"
  | "slow_plugin"
  | "php_error"
  | "high_memory";

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  n_plus_one: "N+1 query",
  duplicate_query: "Duplicate query",
  too_many_queries: "Too many queries",
  slow_query: "Slow query",
  select_star: "SELECT *",
  slow_external: "Slow external",
  failed_external: "Failed external",
  slow_transaction: "Slow transaction",
  slow_plugin: "Slow plugin or theme",
  php_error: "PHP error",
  high_memory: "High memory",
};

export const TRANSACTION_TYPES = ["frontend", "admin", "rest", "ajax", "cron", "cli"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type SpanKind = "db" | "http" | "callback" | "plugin_load" | "theme_load";

export interface SiteSummary {
  id: string;
  name: string;
  url: string;
  keyHint: string;
  createdAt: number;
  requests: number;
  avg: number;
  p50: number;
  p95: number;
  errorRate: number;
  lastSeen: number | null;
  issues: { high: number; medium: number; low: number };
  spark: number[];
}

export interface SiteInfo {
  id: string;
  name: string;
  url: string;
  keyHint: string;
  createdAt: number;
  lastSeen: number | null;
  phpVersion: string;
  wpVersion: string;
  agentVersion: string;
}

export interface CreatedSite {
  site: SiteInfo;
  key: string;
}

export interface TxnSummary {
  requests: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  avgQueries: number;
  ratePerMin: number;
}

export interface TimeBucket {
  t: number;
  requests: number;
  php: number;
  db: number;
  http: number;
}

export interface TxnRow {
  name: string;
  type: string;
  count: number;
  total: number;
  share: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  ratePerMin: number;
  errors: number;
}

export interface TransactionsResponse {
  summary: TxnSummary;
  bucketSeconds: number;
  series: TimeBucket[];
  rows: TxnRow[];
}

export interface ComponentRow {
  component: string;
  total: number;
  share: number;
  max: number;
  avgPerRequest: number;
  requests: number;
  calls: number;
  ratePerMin: number;
}

export interface CallbackRow {
  name: string;
  hook: string;
  component: string;
  count: number;
  total: number;
  avg: number;
  max: number;
}

export interface LoadRow {
  name: string;
  kind: "plugin_load" | "theme_load";
  component: string;
  avg: number;
  max: number;
  count: number;
}

export interface WordPressResponse {
  components: ComponentRow[];
  callbacks: CallbackRow[];
  loads: LoadRow[];
}

export interface QueryRow {
  hash: string;
  fingerprint: string;
  component: string;
  count: number;
  total: number;
  share: number;
  avg: number;
  max: number;
}

export interface QueryComponentRow {
  component: string;
  count: number;
  total: number;
  share: number;
  avg: number;
}

export interface DatabaseResponse {
  queries: QueryRow[];
  components: QueryComponentRow[];
}

export interface ExternalRow {
  host: string;
  method: string;
  count: number;
  total: number;
  share: number;
  max: number;
  avg: number;
  ratePerMin: number;
  errors: number;
}

export interface ErrorGroup {
  fingerprint: string;
  level: string;
  message: string;
  file: string;
  line: number;
  component: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface IssueGroup {
  fingerprint: string;
  type: IssueType;
  severity: Severity;
  title: string;
  route: string;
  subject: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface IssuesResponse {
  issues: IssueGroup[];
  total: number;
  page: number;
  pageSize: number;
  routes: string[];
}

export interface IssueDetail extends IssueGroup {
  detail: string;
  fix: string;
  maxValue: number;
  sample: { transactionId: string; ts: number; url: string } | null;
  recent: { transactionId: string; ts: number; value: number }[];
}

export type SampleBy = "transaction" | "component" | "callback" | "query" | "external" | "error";

export interface Sample {
  transactionId: string;
  ts: number;
  name: string;
  url: string;
  duration: number;
  value: number;
  status: number;
}

export interface SamplesResponse {
  label: string;
  highlights: { label: string; sample: Sample }[];
  recent: Sample[];
}

export interface TraceSpan {
  seq: number;
  kind: SpanKind;
  name: string;
  component: string;
  hook: string;
  file: string;
  start: number;
  duration: number;
  self: number;
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

export interface TraceError {
  level: string;
  message: string;
  file: string;
  line: number;
  component: string;
}

export interface TraceIssue {
  type: IssueType;
  severity: Severity;
  title: string;
  fingerprint: string;
}

export interface Trace {
  id: string;
  ts: number;
  name: string;
  type: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  dbTime: number;
  dbCount: number;
  httpTime: number;
  httpCount: number;
  phpTime: number;
  memoryPeakMb: number;
  memoryLimitMb: number;
  phpVersion: string;
  wpVersion: string;
  agentVersion: string;
  userLoggedIn: boolean;
  droppedSpans: number;
  spans: TraceSpan[];
  errors: TraceError[];
  issues: TraceIssue[];
}
