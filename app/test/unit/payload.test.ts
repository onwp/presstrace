import { describe, expect, it } from "vitest";
import { validatePayload } from "../../src/server/payload";
import { payloadToRows, sanitizeUrl, chTimestamp } from "../../src/server/transform";
import { fastHomeTransaction, payloadOf, productPageTransaction } from "../fixtures/payload";

describe("validatePayload", () => {
  it("accepts the documented example shape", () => {
    const result = validatePayload(payloadOf([productPageTransaction({ withWarning: true })]));
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong version", () => {
    const p = { ...payloadOf([fastHomeTransaction()]), v: 2 };
    expect(validatePayload(p).ok).toBe(false);
  });

  it("rejects missing required fields with a path", () => {
    const t = fastHomeTransaction() as Record<string, unknown>;
    delete t.duration;
    const result = validatePayload(payloadOf([t]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("transactions.0.duration");
  });

  it("rejects unknown span kinds and transaction types", () => {
    const t = fastHomeTransaction();
    (t.spans[0] as Record<string, unknown>).kind = "cache";
    expect(validatePayload(payloadOf([t])).ok).toBe(false);
    expect(validatePayload(payloadOf([{ ...fastHomeTransaction(), type: "worker" }])).ok).toBe(false);
  });

  it("rejects invalid components and error levels", () => {
    const t = fastHomeTransaction();
    t.components = [{ component: "plugin", time: 1, calls: 1 }];
    expect(validatePayload(payloadOf([t])).ok).toBe(false);
    const e = { ...fastHomeTransaction(), errors: [{ level: "panic", message: "x", file: null, line: null, component: "core" }] };
    expect(validatePayload(payloadOf([e])).ok).toBe(false);
  });

  it("rejects negative durations, bad ids and too many spans", () => {
    expect(validatePayload(payloadOf([{ ...fastHomeTransaction(), duration: -1 }])).ok).toBe(false);
    expect(validatePayload(payloadOf([{ ...fastHomeTransaction(), id: "not-hex" }])).ok).toBe(false);
    const many = fastHomeTransaction();
    many.spans = Array.from({ length: 501 }, () => many.spans[0]!);
    expect(validatePayload(payloadOf([many])).ok).toBe(false);
  });

  it("requires sql on db spans and url on http spans", () => {
    const t = fastHomeTransaction();
    delete (t.spans[0] as Record<string, unknown>).sql;
    expect(validatePayload(payloadOf([t])).ok).toBe(false);
    const h = productPageTransaction();
    const httpSpan = h.spans.find((s) => s.kind === "http")!;
    delete httpSpan.url;
    expect(validatePayload(payloadOf([h])).ok).toBe(false);
  });

  it("rejects an empty transaction list and non-objects", () => {
    expect(validatePayload(payloadOf([])).ok).toBe(false);
    expect(validatePayload("hello").ok).toBe(false);
    expect(validatePayload(null).ok).toBe(false);
  });
});

describe("payloadToRows", () => {
  const parsed = validatePayload(payloadOf([productPageTransaction({ withWarning: true, ts: 1792500000123 })]));
  if (!parsed.ok) throw new Error("fixture invalid");
  const rows = payloadToRows("site-1", parsed.payload);

  it("creates one transaction row with breakdown and environment", () => {
    expect(rows.transactions).toHaveLength(1);
    const t = rows.transactions[0]!;
    expect(t.ts).toBe("2026-10-20 12:40:00.123");
    expect(t.php_time).toBeCloseTo(t.duration - t.db_time - t.http_time, 2);
    expect(t.php_version).toBe("8.3.12");
    expect(t.memory_limit_mb).toBe(256);
    expect(t.comp_names).toContain("plugin:woocommerce");
    expect(t.is_error).toBe(0);
  });

  it("fingerprints db spans and extracts http hosts", () => {
    const dbSpan = rows.spans.find((s) => s.kind === "db" && s.sql.includes("wp_postmeta"))!;
    expect(dbSpan.fingerprint).toBe("SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (...) ORDER BY meta_id ASC");
    const httpSpan = rows.spans.find((s) => s.kind === "http")!;
    expect(httpSpan.host).toBe("api.stripe.com");
    expect(httpSpan.method).toBe("POST");
    const cb = rows.spans.find((s) => s.kind === "callback" && s.name === "update_card_payment")!;
    expect(cb.self_time).toBe(1.8);
    expect(cb.hook).toBe("action:woocommerce_add_to_cart");
  });

  it("stores errors and detected issues", () => {
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]!.fingerprint).toMatch(/^[0-9a-f]{24}$/);
    const types = new Set(rows.issues.map((i) => i.type));
    for (const t of ["n_plus_one", "duplicate_query", "slow_query", "select_star", "slow_external", "slow_transaction", "slow_plugin", "php_error"]) {
      expect(types.has(t), t).toBe(true);
    }
  });

  it("marks fatal errors and 5xx as errors", () => {
    const p = validatePayload(payloadOf([{ ...fastHomeTransaction(), status: 500 }]));
    if (!p.ok) throw new Error("invalid");
    expect(payloadToRows("s", p.payload).transactions[0]!.is_error).toBe(1);
  });
});

describe("helpers", () => {
  it("sanitizeUrl removes query, fragment and credentials", () => {
    expect(sanitizeUrl("https://u:p@example.com/a/?token=1#x")).toBe("https://example.com/a/");
    expect(sanitizeUrl("/relative/path?x=1")).toBe("/relative/path");
  });

  it("chTimestamp formats UTC with milliseconds", () => {
    expect(chTimestamp(0)).toBe("1970-01-01 00:00:00.000");
  });
});

describe("withinTimeWindow", () => {
  it("keeps transactions from now minus the retention to now plus one hour", async () => {
    const { withinTimeWindow } = await import("../../src/server/payload");
    const now = 1_800_000_000_000;
    const day = 86_400_000;
    const p = validatePayload(
      payloadOf([fastHomeTransaction(now), fastHomeTransaction(now + 3_599_000), fastHomeTransaction(now + 3_601_000), fastHomeTransaction(now - 31 * day)]),
    );
    if (!p.ok) throw new Error("fixture");
    const out = withinTimeWindow(p.payload, now, 30 * day);
    expect(out.payload.transactions.map((t) => t.ts)).toEqual([now, now + 3_599_000]);
    expect(out.rejected).toBe(2);
  });
});
