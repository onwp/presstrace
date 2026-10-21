import { describe, expect, it } from "vitest";
import {
  coreTable,
  detectIssues,
  errorFingerprint,
  issueFingerprint,
  normalizeErrorMessage,
  type DetectInput,
  type DetectSpan,
} from "../../src/server/detect";
import { fingerprintSql } from "../../src/server/fingerprint";

function input(over: Partial<DetectInput> = {}): DetectInput {
  return {
    name: "single-product",
    duration: 200,
    dbTime: 10,
    dbCount: 5,
    httpTime: 0,
    memoryPeakMb: 40,
    memoryLimitMb: 256,
    spans: [],
    components: [],
    errors: [],
    ...over,
  };
}

function db(sql: string, duration = 1, component = "core"): DetectSpan {
  return { kind: "db", name: "q", duration, component, sql, fingerprint: fingerprintSql(sql) };
}

function http(over: Partial<DetectSpan> = {}): DetectSpan {
  return {
    kind: "http",
    name: "api.example.com GET",
    duration: 100,
    component: "plugin:demo",
    host: "api.example.com",
    method: "GET",
    status: 200,
    error: null,
    ...over,
  };
}

const ofType = (issues: ReturnType<typeof detectIssues>, type: string) => issues.filter((i) => i.type === type);

describe("N+1 query", () => {
  const loop = (n: number, ms = 1) =>
    Array.from({ length: n }, (_, i) => db(`SELECT meta_value FROM wp_postmeta WHERE post_id = ${i + 1}`, ms, "plugin:woocommerce"));

  it("is not raised below 5 executions", () => {
    expect(ofType(detectIssues(input({ spans: loop(4) })), "n_plus_one")).toHaveLength(0);
  });

  it("is low at 5 executions with small total time", () => {
    const [issue] = ofType(detectIssues(input({ spans: loop(5) })), "n_plus_one");
    expect(issue?.severity).toBe("low");
    expect(issue?.value).toBe(5);
    expect(issue?.detail).toContain("5 times");
    expect(issue?.detail).toContain('the plugin "woocommerce"');
    expect(issue?.fix).toContain("update_meta_cache");
  });

  it("is medium at 20 executions", () => {
    expect(ofType(detectIssues(input({ spans: loop(20) })), "n_plus_one")[0]?.severity).toBe("medium");
  });

  it("is medium when the total time is 50 ms or more", () => {
    expect(ofType(detectIssues(input({ spans: loop(5, 10) })), "n_plus_one")[0]?.severity).toBe("medium");
  });

  it("is not raised when every execution is identical (that is a duplicate)", () => {
    const same = Array.from({ length: 6 }, () => db("SELECT 1 FROM wp_posts WHERE ID = 1"));
    expect(ofType(detectIssues(input({ spans: same })), "n_plus_one")).toHaveLength(0);
  });

  it("keeps single option lookups low with option-specific advice, however many", () => {
    const options = Array.from({ length: 40 }, (_, i) =>
      db(`SELECT option_value FROM wp_options WHERE option_name = 'woocommerce_opt_${i}' LIMIT 1`, 3, "plugin:woocommerce"),
    );
    const [issue] = ofType(detectIssues(input({ spans: options })), "n_plus_one");
    expect(issue?.severity).toBe("low");
    expect(issue?.title).toBe("Options loaded one by one");
    expect(issue?.detail).toContain("not autoloaded");
    expect(issue?.fix).toContain("wp_prime_option_caches");
    expect(issue?.fix).toContain("persistent object cache");
  });

  it("still rates other option queries by the normal rule", () => {
    const batches = Array.from({ length: 20 }, (_, i) => db(`SELECT option_name, option_value FROM wp_options WHERE option_name IN ('a${i}', 'b${i}')`));
    expect(ofType(detectIssues(input({ spans: batches })), "n_plus_one")[0]?.severity).toBe("medium");
  });

  it("gives table-specific WordPress advice", () => {
    const users = Array.from({ length: 6 }, (_, i) => db(`SELECT * FROM wp_users WHERE ID = ${i}`));
    expect(ofType(detectIssues(input({ spans: users })), "n_plus_one")[0]?.fix).toContain("cache_users");
    const terms = Array.from({ length: 6 }, (_, i) => db(`SELECT t.* FROM wp_terms t WHERE term_id = ${i}`));
    expect(ofType(detectIssues(input({ spans: terms })), "n_plus_one")[0]?.fix).toContain("update_object_term_cache");
    const custom = Array.from({ length: 6 }, (_, i) => db(`SELECT * FROM wp_my_table WHERE id = ${i}`));
    expect(ofType(detectIssues(input({ spans: custom })), "n_plus_one")[0]?.fix).toContain("wp_cache_get");
  });
});

describe("duplicate query", () => {
  it("is raised for identical SQL 3+ times", () => {
    const spans = Array.from({ length: 3 }, () => db("SELECT option_value FROM wp_options WHERE option_name = 'x'"));
    const [issue] = ofType(detectIssues(input({ spans })), "duplicate_query");
    expect(issue?.severity).toBe("low");
    expect(issue?.fix).toContain("add_option");
  });

  it("is not raised twice", () => {
    const spans = Array.from({ length: 2 }, () => db("SELECT 1"));
    expect(ofType(detectIssues(input({ spans })), "duplicate_query")).toHaveLength(0);
  });

  it("is raised once per fingerprint when two literal sets each repeat", () => {
    const spans = [
      ...Array.from({ length: 3 }, () => db("SELECT option_value FROM wp_options WHERE option_name = 'a'")),
      ...Array.from({ length: 4 }, () => db("SELECT option_value FROM wp_options WHERE option_name = 'b'")),
    ];
    const dups = ofType(detectIssues(input({ spans })), "duplicate_query");
    expect(dups).toHaveLength(1);
    expect(dups[0]?.detail).toContain("4 times");
  });
});

describe("too many queries", () => {
  it("is not raised below 100", () => {
    expect(ofType(detectIssues(input({ dbCount: 99 })), "too_many_queries")).toHaveLength(0);
  });
  it("is low at 100 and medium at 300", () => {
    expect(ofType(detectIssues(input({ dbCount: 100 })), "too_many_queries")[0]?.severity).toBe("low");
    const medium = ofType(detectIssues(input({ dbCount: 300 })), "too_many_queries")[0];
    expect(medium?.severity).toBe("medium");
    expect(medium?.fix).toContain("Redis");
  });
});

describe("slow query", () => {
  it("is medium at 100 ms and high at 1000 ms", () => {
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_posts", 99)] })), "slow_query")).toHaveLength(0);
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_posts", 100)] })), "slow_query")[0]?.severity).toBe("medium");
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_posts", 1000)] })), "slow_query")[0]?.severity).toBe("high");
  });

  it("explains autoloaded options", () => {
    const [issue] = ofType(
      detectIssues(input({ spans: [db("SELECT option_name, option_value FROM wp_options WHERE autoload = 'yes'", 150)] })),
      "slow_query",
    );
    expect(issue?.fix).toContain("autoload");
  });

  it("explains meta_value queries and ORDER BY RAND()", () => {
    const meta = db("SELECT p.ID FROM wp_posts p JOIN wp_postmeta m ON m.post_id = p.ID WHERE m.meta_value = 'x'", 200);
    expect(ofType(detectIssues(input({ spans: [meta] })), "slow_query")[0]?.fix).toContain("meta_value");
    const rand = db("SELECT ID FROM wp_posts ORDER BY RAND() LIMIT 5", 200);
    expect(ofType(detectIssues(input({ spans: [rand] })), "slow_query")[0]?.fix).toContain("RAND()");
  });
});

describe("SELECT *", () => {
  it("is raised for plugins and themes only", () => {
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_log", 1, "plugin:demo")] })), "select_star")[0]?.severity).toBe("low");
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_log", 1, "theme:astra")] })), "select_star")).toHaveLength(1);
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_log", 1, "core")] })), "select_star")).toHaveLength(0);
  });

  it("suggests the fields parameter", () => {
    expect(ofType(detectIssues(input({ spans: [db("SELECT * FROM wp_log", 1, "plugin:demo")] })), "select_star")[0]?.fix).toContain(
      "'fields' => 'ids'",
    );
  });
});

describe("external requests", () => {
  it("slow external is medium at 500 ms and high at 2000 ms", () => {
    expect(ofType(detectIssues(input({ spans: [http({ duration: 499 })] })), "slow_external")).toHaveLength(0);
    expect(ofType(detectIssues(input({ spans: [http({ duration: 500 })] })), "slow_external")[0]?.severity).toBe("medium");
    const high = ofType(detectIssues(input({ spans: [http({ duration: 2000 })] })), "slow_external")[0];
    expect(high?.severity).toBe("high");
    expect(high?.subject).toBe("GET api.example.com");
    expect(high?.fix).toContain("set_transient");
  });

  it("failed external on transport error or 5xx", () => {
    expect(ofType(detectIssues(input({ spans: [http({ error: "cURL error 28: timed out" })] })), "failed_external")[0]?.detail).toContain(
      "cURL error 28",
    );
    expect(ofType(detectIssues(input({ spans: [http({ status: 503 })] })), "failed_external")[0]?.detail).toContain("HTTP 503");
    expect(ofType(detectIssues(input({ spans: [http({ status: 404 })] })), "failed_external")).toHaveLength(0);
  });
});

describe("slow transaction", () => {
  it("is medium at 1000 ms and high at 3000 ms", () => {
    expect(ofType(detectIssues(input({ duration: 999 })), "slow_transaction")).toHaveLength(0);
    expect(ofType(detectIssues(input({ duration: 1000 })), "slow_transaction")[0]?.severity).toBe("medium");
    expect(ofType(detectIssues(input({ duration: 3000 })), "slow_transaction")[0]?.severity).toBe("high");
  });

  it("targets the dominant part of the request", () => {
    expect(ofType(detectIssues(input({ duration: 3000, httpTime: 2500 })), "slow_transaction")[0]?.fix).toContain("external HTTP");
    expect(ofType(detectIssues(input({ duration: 3000, dbTime: 2500 })), "slow_transaction")[0]?.fix).toContain("MySQL");
    expect(ofType(detectIssues(input({ duration: 3000, dbTime: 10 })), "slow_transaction")[0]?.fix).toContain("OPcache");
  });
});

describe("slow plugin", () => {
  it("is medium at 200 ms and high at 1000 ms self time, never for core", () => {
    const run = (component: string, time: number) =>
      ofType(detectIssues(input({ components: [{ component, time, calls: 3 }] })), "slow_plugin");
    expect(run("plugin:demo", 199)).toHaveLength(0);
    expect(run("plugin:demo", 200)[0]?.severity).toBe("medium");
    expect(run("plugin:demo", 1000)[0]?.severity).toBe("high");
    expect(run("theme:astra", 300)[0]?.title).toBe("Slow theme");
    expect(run("core", 5000)).toHaveLength(0);
  });
});

describe("PHP errors", () => {
  const err = (level: string) => ({ level, message: "Boom 42", file: "wp-content/plugins/demo/a.php", line: 3, component: "plugin:demo" });

  it("fatal and exception are high, warning is low", () => {
    expect(ofType(detectIssues(input({ errors: [err("fatal")] })), "php_error")[0]?.severity).toBe("high");
    expect(ofType(detectIssues(input({ errors: [err("exception")] })), "php_error")[0]?.title).toBe("Uncaught exception");
    expect(ofType(detectIssues(input({ errors: [err("warning")] })), "php_error")[0]?.severity).toBe("low");
  });

  it("notices and deprecations are not raised", () => {
    expect(ofType(detectIssues(input({ errors: [err("notice"), err("deprecated")] })), "php_error")).toHaveLength(0);
  });

  it("deduplicates the same error in one request", () => {
    expect(ofType(detectIssues(input({ errors: [err("warning"), err("warning")] })), "php_error")).toHaveLength(1);
  });
});

describe("high memory", () => {
  it("is raised at 80% of memory_limit", () => {
    expect(ofType(detectIssues(input({ memoryPeakMb: 204, memoryLimitMb: 256 })), "high_memory")).toHaveLength(0);
    const [issue] = ofType(detectIssues(input({ memoryPeakMb: 205, memoryLimitMb: 256 })), "high_memory");
    expect(issue?.severity).toBe("medium");
    expect(issue?.detail).toContain("80%");
  });

  it("is skipped when memory_limit is unlimited", () => {
    expect(ofType(detectIssues(input({ memoryPeakMb: 2000, memoryLimitMb: -1 })), "high_memory")).toHaveLength(0);
  });
});

describe("fingerprints", () => {
  it("issue fingerprints are stable and route-specific", () => {
    expect(issueFingerprint("slow_query", "home", "x")).toBe(issueFingerprint("slow_query", "home", "x"));
    expect(issueFingerprint("slow_query", "home", "x")).not.toBe(issueFingerprint("slow_query", "page", "x"));
  });

  it("issues carry route and fingerprint", () => {
    const [issue] = detectIssues(input({ dbCount: 150 }));
    expect(issue?.route).toBe("single-product");
    expect(issue?.fingerprint).toBe(issueFingerprint("too_many_queries", "single-product", ""));
  });

  it("error messages group across ids", () => {
    expect(normalizeErrorMessage("Order 123 not found")).toBe("Order ? not found");
    expect(errorFingerprint("warning", "Order 1 missing", "a.php", 1)).toBe(errorFingerprint("warning", "Order 2 missing", "a.php", 1));
  });

  it("strips table prefixes for advice", () => {
    expect(coreTable("wp_2_postmeta")).toBe("postmeta");
    expect(coreTable("custom_users")).toBe("users");
    expect(coreTable("wp_wc_orders")).toBeNull();
  });
});
