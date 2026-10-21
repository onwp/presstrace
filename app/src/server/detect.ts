import { createHash } from "node:crypto";
import { isSelectStar, primaryTable } from "./fingerprint";
import type { IssueType, Severity } from "../shared/types";

export interface DetectSpan {
  kind: "db" | "http" | "callback" | "plugin_load" | "theme_load";
  name: string;
  duration: number;
  component: string;
  sql?: string;
  fingerprint?: string;
  host?: string;
  method?: string;
  status?: number | null;
  error?: string | null;
}

export interface DetectInput {
  name: string;
  duration: number;
  dbTime: number;
  dbCount: number;
  httpTime: number;
  memoryPeakMb: number;
  memoryLimitMb: number;
  spans: DetectSpan[];
  components: { component: string; time: number; calls: number }[];
  errors: { level: string; message: string; file: string; line: number; component: string }[];
}

export interface DetectedIssue {
  type: IssueType;
  severity: Severity;
  fingerprint: string;
  route: string;
  subject: string;
  title: string;
  detail: string;
  fix: string;
  value: number;
}

export const THRESHOLDS = {
  nPlusOneCount: 5,
  nPlusOneMediumCount: 20,
  nPlusOneMediumMs: 50,
  duplicateCount: 3,
  tooManyQueriesLow: 100,
  tooManyQueriesMedium: 300,
  slowQueryMedium: 100,
  slowQueryHigh: 1000,
  slowExternalMedium: 500,
  slowExternalHigh: 2000,
  slowTransactionMedium: 1000,
  slowTransactionHigh: 3000,
  slowPluginMedium: 200,
  slowPluginHigh: 1000,
  highMemoryRatio: 0.8,
} as const;

export function fmtMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 10) return `${Math.round(value)} ms`;
  return `${value.toFixed(1)} ms`;
}

function shorten(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function issueFingerprint(type: string, route: string, subject: string): string {
  return createHash("sha256").update(`${type}\u0000${route}\u0000${subject}`).digest("hex").slice(0, 24);
}

/** Normalizes an error message so that ids and numbers do not split one error into many groups. */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/\b0x[0-9a-f]+\b/gi, "0x?")
    .replace(/\b\d+(\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function errorFingerprint(level: string, message: string, file: string, line: number): string {
  return createHash("sha256")
    .update(`${level}\u0000${normalizeErrorMessage(message)}\u0000${file}\u0000${line}`)
    .digest("hex")
    .slice(0, 24);
}

function describeComponent(component: string): string {
  const [kind, slug] = component.includes(":") ? component.split(/:(.*)/s) : [component, ""];
  switch (kind) {
    case "plugin":
      return `the plugin "${slug}"`;
    case "mu-plugin":
      return `the must-use plugin "${slug}"`;
    case "theme":
      return `the theme "${slug}"`;
    case "dropin":
      return `the drop-in "${slug}"`;
    case "core":
      return "WordPress core";
    default:
      return "an unknown component";
  }
}

const isExtension = (component: string) => /^(plugin|mu-plugin|theme|dropin):/.test(component);

/** Strips the table prefix (wp_, wp_2_, custom) so advice can match core tables. */
export function coreTable(table: string | null): string | null {
  if (!table) return null;
  const bare = table.split(".").pop()!.toLowerCase();
  const m = /(?:^|_)(postmeta|posts|termmeta|term_relationships|term_taxonomy|terms|usermeta|users|options|commentmeta|comments)$/.exec(bare);
  return m ? m[1]! : null;
}

/** A single-row lookup on the options table by name, as get_option() runs it for options that are not autoloaded. */
export function isSingleOptionLookup(fp: string): boolean {
  return coreTable(primaryTable(fp)) === "options" && /\bWHERE\s+option_name\s*=\s*\?/i.test(fp);
}

function nPlusOneFix(fp: string): string {
  switch (coreTable(primaryTable(fp))) {
    case "postmeta":
      return "Post meta is fetched one post at a time. Prime the meta cache for all posts before the loop with update_meta_cache( 'post', $post_ids ) (or update_postmeta_cache( $post_ids )). When the posts come from WP_Query, keep 'update_post_meta_cache' => true, which is the default, and do not pass 'cache_results' => false. A persistent object cache such as Redis keeps the primed meta across requests.";
    case "posts":
      return "Posts are loaded one by one, usually with get_post() or get_permalink() inside a loop over IDs. Load them in one query with new WP_Query( array( 'post__in' => $ids, 'posts_per_page' => count( $ids ) ) ), or prime the cache first with _prime_post_caches( $ids ) or update_post_caches( $posts ).";
    case "termmeta":
      return "Term meta is fetched per term. Call update_termmeta_cache( $term_ids ) before the loop, or query terms with get_terms( array( 'update_term_meta_cache' => true ) ).";
    case "terms":
    case "term_taxonomy":
    case "term_relationships":
      return "Terms are fetched per post, usually by get_the_terms() or wp_get_post_terms() in a loop. Prime them with update_object_term_cache( $post_ids, 'post' ), or keep 'update_post_term_cache' => true on WP_Query. Note that wp_get_post_terms() always bypasses the cache, so prefer get_the_terms().";
    case "usermeta":
    case "users":
      return "Users or user meta are loaded per row, often for author names or avatars in a list. Call cache_users( $user_ids ) before the loop so all users and their meta come from one query, or use WP_User_Query with 'include' => $user_ids.";
    case "options":
      return "get_option() is called repeatedly for options that are not autoloaded or do not exist. Read the options once into a variable, mark options that are needed on every request as autoloaded, and add missing options with add_option() so WordPress can cache that they are empty. A persistent object cache removes these lookups entirely.";
    case "comments":
    case "commentmeta":
      return "Comments or comment meta are fetched one at a time. Load comments with a single get_comments() call and prime meta with update_meta_cache( 'comment', $comment_ids ).";
    default:
      return "Load all rows in one query (for example WHERE id IN (...)) before the loop and look them up from an array, instead of querying inside the loop. If the data is reused across requests, cache each result with wp_cache_get() / wp_cache_set() backed by a persistent object cache, or with a transient.";
  }
}

function slowQueryFix(fp: string): string {
  const table = coreTable(primaryTable(fp));
  if (table === "options" && /autoload/i.test(fp)) {
    return "This is the autoloaded options query that runs on every request. Check the autoload size with SELECT SUM(LENGTH(option_value)) FROM wp_options WHERE autoload IN ('yes', 'on'). Anything above about 1 MB slows every page: find the largest rows and set autoload to 'off' for options that are not needed on every request (wp_set_option_autoload() in WordPress 6.4+), and delete leftovers of removed plugins and expired transients.";
  }
  if (/postmeta/i.test(fp) && /meta_value/i.test(fp)) {
    return "This meta query filters or sorts on meta_value, which has no useful index in wp_postmeta. Avoid meta_query on large sites where possible: store the value in a taxonomy, a dedicated column in a custom table, or add a targeted index. Cache the result with a transient or wp_cache_set() and invalidate it when the data changes.";
  }
  if (/ORDER BY RAND\(\)/i.test(fp)) {
    return "ORDER BY RAND() forces MySQL to read and sort the whole table. Pick random IDs in PHP from a cached list of IDs, or cache the random selection in a transient for a few minutes.";
  }
  return "Run EXPLAIN on this query to see whether it uses an index. Add an index on the columns used in WHERE, JOIN and ORDER BY, avoid LIKE '%...%' and functions on indexed columns, and limit the rows returned. If the result does not change on every request, cache it with a transient or wp_cache_set().";
}

function externalFix(): string {
  return "Cache the response with set_transient() so the call runs once per interval instead of on every request. Move calls that do not need to finish before the page is rendered to WP-Cron (wp_schedule_single_event()) or Action Scheduler. Pass a short 'timeout' to wp_remote_get() / wp_remote_post() (the default is 5 seconds) and handle failures without retrying on every page view. Update or license checks that run on every admin page are worth reporting to the plugin author.";
}

function slowTransactionFix(input: DetectInput): string {
  const php = Math.max(0, input.duration - input.dbTime - input.httpTime);
  if (input.httpTime >= input.duration * 0.5) {
    return `Most of the time was spent waiting for external HTTP calls. ${externalFix()}`;
  }
  if (input.dbTime >= input.duration * 0.5) {
    return "Most of the time was spent in MySQL. Open the Database tab for this transaction to find the slowest query fingerprints, add indexes for slow queries, remove N+1 patterns, and add a persistent object cache (Redis or Memcached) to avoid repeated lookups.";
  }
  if (php >= input.duration * 0.5) {
    return "Most of the time was spent running PHP. Open a sample trace and sort spans by duration to find the slowest plugin callbacks. For anonymous front-end traffic a full page cache avoids running WordPress at all. Make sure OPcache is enabled, the site runs a supported PHP 8 version, and remove plugins that are not needed on this route.";
  }
  return "Open a sample trace to see where the time goes: sort spans by duration and check the breakdown of PHP, MySQL and external time. A full page cache for anonymous traffic and a persistent object cache help most WordPress sites.";
}

/** Runs every detection rule against one transaction. */
export function detectIssues(input: DetectInput): DetectedIssue[] {
  const T = THRESHOLDS;
  const route = input.name;
  const out: DetectedIssue[] = [];
  const push = (issue: Omit<DetectedIssue, "fingerprint" | "route">) =>
    out.push({ ...issue, route, fingerprint: issueFingerprint(issue.type, route, issue.subject) });

  const db = input.spans.filter((s) => s.kind === "db" && s.fingerprint);
  const byFp = new Map<string, DetectSpan[]>();
  const bySql = new Map<string, DetectSpan[]>();
  for (const s of db) {
    const fp = s.fingerprint!;
    (byFp.get(fp) ?? byFp.set(fp, []).get(fp)!).push(s);
    const raw = (s.sql ?? "").trim();
    (bySql.get(raw) ?? bySql.set(raw, []).get(raw)!).push(s);
  }

  // N+1: same fingerprint 5+ times with differing literals.
  for (const [fp, spans] of byFp) {
    if (spans.length < T.nPlusOneCount) continue;
    const distinctSql = new Set(spans.map((s) => (s.sql ?? "").trim())).size;
    if (distinctSql < 2) continue;
    const total = spans.reduce((sum, s) => sum + s.duration, 0);
    const component = mostCommon(spans.map((s) => s.component));
    if (isSingleOptionLookup(fp)) {
      // get_option() misses for options that are not autoloaded: common and cheap, so always low.
      push({
        type: "n_plus_one",
        severity: "low",
        subject: fp,
        title: "Options loaded one by one",
        detail: `${spans.length} options were read from the database one at a time in one "${route}" request (${fmtMs(total)} in total). WordPress loads autoloaded options in one query at startup; options that are not autoloaded, or do not exist, cost one query each time get_option() asks for them. Most lookups come from ${describeComponent(component)}.`,
        fix: "Install a persistent object cache (Redis or Memcached) so these options are served from memory. If an option is needed on every request, store it with autoload enabled (update_option( $name, $value, true )). Code that reads a known list of options can load them in one query with wp_prime_option_caches( $names ) (WordPress 6.4 or newer). Create missing options with add_option() so WordPress caches that they are empty.",
        value: spans.length,
      });
      continue;
    }
    push({
      type: "n_plus_one",
      severity: spans.length >= T.nPlusOneMediumCount || total >= T.nPlusOneMediumMs ? "medium" : "low",
      subject: fp,
      title: "Possible N+1 query",
      detail: `The query "${shorten(fp)}" ran ${spans.length} times in one "${route}" request (${fmtMs(total)} in total), each time with different values. This is the N+1 pattern: code inside a loop, usually over posts, products or users, fetches one row at a time instead of loading all rows at once. Most calls come from ${describeComponent(component)}.`,
      fix: nPlusOneFix(fp),
      value: spans.length,
    });
  }

  // Duplicate: identical SQL 3+ times. One event per fingerprint (the largest group), so two SQL strings
  // with the same shape do not raise the same issue twice in one transaction.
  const dupByFp = new Map<string, DetectSpan[]>();
  for (const [sql, spans] of bySql) {
    if (spans.length < T.duplicateCount || sql === "") continue;
    const fp = spans[0]!.fingerprint!;
    if ((dupByFp.get(fp)?.length ?? 0) < spans.length) dupByFp.set(fp, spans);
  }
  for (const [fp, spans] of dupByFp) {
    const total = spans.reduce((sum, s) => sum + s.duration, 0);
    push({
      type: "duplicate_query",
      severity: "low",
      subject: fp,
      title: "Duplicate query",
      detail: `The exact same query, with the same values, ran ${spans.length} times in one "${route}" request (${fmtMs(total)} in total): "${shorten(fp)}". The result was not reused between calls. Most calls come from ${describeComponent(mostCommon(spans.map((s) => s.component)))}.`,
      fix: "Keep the result after the first call: in a variable or static property for the current request, or with wp_cache_set() so other code paths can reuse it. If it is a get_option() call for an option that does not exist, create the option with add_option() so WordPress caches the empty value. Direct $wpdb calls bypass the object cache, so prefer the WordPress API functions (get_post_meta(), get_option(), get_term()) where they exist.",
      value: spans.length,
    });
  }

  // Too many queries.
  if (input.dbCount >= T.tooManyQueriesLow) {
    push({
      type: "too_many_queries",
      severity: input.dbCount >= T.tooManyQueriesMedium ? "medium" : "low",
      subject: "",
      title: "Too many queries",
      detail: `One "${route}" request ran ${input.dbCount} database queries, taking ${fmtMs(input.dbTime)} in MySQL. Each query is a round trip to the database, so hundreds of small queries add up even when each one is fast.`,
      fix: "Install a persistent object cache (Redis or Memcached with a drop-in such as Redis Object Cache) so options, post meta, terms and users are served from memory instead of MySQL. Then open the Database tab to see which components run the most queries and look for N+1 patterns. For anonymous front-end traffic, a full page cache avoids the queries entirely.",
      value: input.dbCount,
    });
  }

  // Slow query: one issue per fingerprint, measured by its slowest execution.
  for (const [fp, spans] of byFp) {
    const slowest = spans.reduce((a, b) => (b.duration > a.duration ? b : a));
    if (slowest.duration < T.slowQueryMedium) continue;
    push({
      type: "slow_query",
      severity: slowest.duration >= T.slowQueryHigh ? "high" : "medium",
      subject: fp,
      title: "Slow query",
      detail: `A query from ${describeComponent(slowest.component)} took ${fmtMs(slowest.duration)} in one "${route}" request: "${shorten(fp)}". The PHP request waits for MySQL during that time, and slow queries also hold database resources that other requests need.`,
      fix: slowQueryFix(fp),
      value: slowest.duration,
    });
  }

  // SELECT * from a plugin or theme.
  const starSeen = new Set<string>();
  for (const s of db) {
    const fp = s.fingerprint!;
    if (!isExtension(s.component) || !isSelectStar(fp) || starSeen.has(fp)) continue;
    starSeen.add(fp);
    push({
      type: "select_star",
      severity: "low",
      subject: fp,
      title: "SELECT * query",
      detail: `${capitalize(describeComponent(s.component))} selects every column: "${shorten(fp)}". Wide columns such as post_content, meta_value or option_value are read and sent to PHP even when the code only needs a few fields, which costs memory and time.`,
      fix: "Select only the columns the code uses. With WP_Query or get_posts() pass 'fields' => 'ids' when only IDs are needed; with WP_User_Query pass 'fields' => array( 'ID', 'display_name' ); in direct $wpdb queries list the columns explicitly instead of *.",
      value: s.duration,
    });
  }

  // External calls.
  const http = input.spans.filter((s) => s.kind === "http");
  const slowExt = new Map<string, DetectSpan>();
  const failedExt = new Map<string, DetectSpan>();
  for (const s of http) {
    const key = `${(s.method ?? "GET").toUpperCase()} ${s.host ?? ""}`;
    if (s.duration >= T.slowExternalMedium) {
      const prev = slowExt.get(key);
      if (!prev || s.duration > prev.duration) slowExt.set(key, s);
    }
    if ((s.error ?? "") !== "" || (s.status ?? 0) >= 500) {
      if (!failedExt.has(key)) failedExt.set(key, s);
    }
  }
  for (const [key, s] of slowExt) {
    push({
      type: "slow_external",
      severity: s.duration >= T.slowExternalHigh ? "high" : "medium",
      subject: key,
      title: "Slow external request",
      detail: `A ${key} request made by ${describeComponent(s.component)} took ${fmtMs(s.duration)}. PHP waits for the remote server to answer, so the whole "${route}" request is at least that slow for the visitor.`,
      fix: externalFix(),
      value: s.duration,
    });
  }
  for (const [key, s] of failedExt) {
    const reason = (s.error ?? "") !== "" ? `failed with "${shorten(s.error!, 200)}"` : `returned HTTP ${s.status}`;
    push({
      type: "failed_external",
      severity: "medium",
      subject: key,
      title: "Failed external request",
      detail: `A ${key} request made by ${describeComponent(s.component)} ${reason} after ${fmtMs(s.duration)}. The feature that depends on it probably did not work for this "${route}" request.`,
      fix: "Check that the remote service is reachable from the server and that API keys or licenses are valid. In code, check is_wp_error() and wp_remote_retrieve_response_code() before using the body, and after a failure store a short-lived transient so the site does not retry the failing call on every request. Set a short 'timeout' so failures do not block the page.",
      value: s.duration,
    });
  }

  // Slow transaction.
  if (input.duration >= T.slowTransactionMedium) {
    const php = Math.max(0, input.duration - input.dbTime - input.httpTime);
    push({
      type: "slow_transaction",
      severity: input.duration >= T.slowTransactionHigh ? "high" : "medium",
      subject: "",
      title: "Slow transaction",
      detail: `The "${route}" request took ${fmtMs(input.duration)}: ${fmtMs(php)} in PHP, ${fmtMs(input.dbTime)} in MySQL and ${fmtMs(input.httpTime)} waiting for external calls.`,
      fix: slowTransactionFix(input),
      value: input.duration,
    });
  }

  // Slow plugin or theme by self time.
  for (const c of input.components) {
    if (!isExtension(c.component) || c.time < T.slowPluginMedium) continue;
    const isTheme = c.component.startsWith("theme:");
    push({
      type: "slow_plugin",
      severity: c.time >= T.slowPluginHigh ? "high" : "medium",
      subject: c.component,
      title: isTheme ? "Slow theme" : "Slow plugin",
      detail: `${capitalize(describeComponent(c.component))} used ${fmtMs(c.time)} of its own time in one "${route}" request, across ${c.calls} hook callback ${c.calls === 1 ? "call" : "calls"}. This includes the database queries and external requests its callbacks made, and excludes time spent in other plugins it calls.`,
      fix: isTheme
        ? "Open the WordPress tab to see which theme callbacks are slow. Heavy page builders and theme frameworks often run expensive work on every request: disable unused theme features, cache generated CSS and menus, or switch to a lighter theme."
        : "Open the WordPress tab to see which hooks and callbacks of this plugin are slowest, and open a sample trace to see what they do (queries, external calls). Disable plugin features you do not use, load the plugin only on pages that need it, update it to the latest version, or replace it with a lighter alternative. Report the slow callback to the plugin author with the trace details.",
      value: c.time,
    });
  }

  // PHP errors: fatal, error and exception are high, warnings low, notices and deprecations ignored.
  const errSeen = new Set<string>();
  for (const e of input.errors) {
    if (e.level === "notice" || e.level === "deprecated") continue;
    const subject = `${e.level}|${normalizeErrorMessage(e.message)}|${e.file}:${e.line}`;
    if (errSeen.has(subject)) continue;
    errSeen.add(subject);
    const where = e.file ? ` in ${e.file}${e.line ? `:${e.line}` : ""}` : "";
    const who = describeComponent(e.component);
    if (e.level === "warning") {
      push({
        type: "php_error",
        severity: "low",
        subject,
        title: "PHP warning",
        detail: `${capitalize(who)} raised a PHP warning${where}: "${shorten(e.message, 300)}". Warnings do not stop the request, but they usually point to a bug such as an undefined array key or a missing file, and they fill the error log.`,
        fix: `Update ${who} to the latest version and report the warning to its author if it persists. Keep WP_DEBUG_DISPLAY off on production so warnings are not shown to visitors, and use WP_DEBUG_LOG on a staging copy to reproduce it.`,
        value: 1,
      });
    } else {
      const title = e.level === "exception" ? "Uncaught exception" : e.level === "fatal" ? "PHP fatal error" : "PHP error";
      push({
        type: "php_error",
        severity: "high",
        subject,
        title,
        detail: `${capitalize(who)} stopped the "${route}" request with ${e.level === "exception" ? "an uncaught exception" : "a fatal error"}${where}: "${shorten(e.message, 300)}". Visitors see an error page or a broken response.`,
        fix: `Check whether ${who} was recently updated or needs a newer PHP version (see "Requires PHP" in its readme). Roll back or update it, and reproduce the error on a staging copy with WP_DEBUG and WP_DEBUG_LOG enabled. WordPress recovery mode can pause the component from the admin email link while you fix it.`,
        value: 1,
      });
    }
  }

  // High memory.
  if (input.memoryLimitMb > 0 && input.memoryPeakMb >= input.memoryLimitMb * T.highMemoryRatio) {
    const pct = Math.round((input.memoryPeakMb / input.memoryLimitMb) * 100);
    push({
      type: "high_memory",
      severity: "medium",
      subject: "",
      title: "High memory usage",
      detail: `The "${route}" request peaked at ${input.memoryPeakMb.toFixed(1)} MB, ${pct}% of the ${input.memoryLimitMb} MB PHP memory_limit. Close to the limit, requests fail with "Allowed memory size exhausted" fatal errors.`,
      fix: "Find the code that loads large data sets: WP_Query with 'posts_per_page' => -1, loading every user, order or product, or very large option arrays. Paginate, use 'fields' => 'ids', and process large jobs in batches through WP-Cron or Action Scheduler. Raise WP_MEMORY_LIMIT in wp-config.php only after confirming the usage is expected.",
      value: input.memoryPeakMb,
    });
  }

  return out;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  let best = values[0] ?? "unknown";
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
