import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSql } from "../../src/web/lib/sql";
import { ago, component, ms, pct, rate, shareLevel } from "../../src/web/lib/format";
import { wpConfigSnippet } from "../../src/web/components/Setup";
import { safeNext } from "../../src/web/lib/redirect";

describe("formatSql", () => {
  it("breaks main clauses onto lines and indents AND/OR", () => {
    expect(formatSql("SELECT a FROM t LEFT JOIN u ON u.id = t.id WHERE a = 1 AND b = 2 ORDER BY a LIMIT 1")).toBe(
      "SELECT a\nFROM t\nLEFT JOIN u ON u.id = t.id\nWHERE a = 1\n  AND b = 2\nORDER BY a\nLIMIT 1",
    );
  });
  it("leaves string literals untouched", () => {
    expect(formatSql("SELECT 'a FROM b' FROM t")).toBe("SELECT 'a FROM b'\nFROM t");
  });
});

describe("format helpers", () => {
  it("formats durations, percentages and rates", () => {
    expect(ms(1.234)).toBe("1.2 ms");
    expect(ms(1234)).toBe("1,234 ms");
    expect(ms(12_500)).toBe("12.50 s");
    expect(pct(0.05)).toBe("<0.1%");
    expect(pct(12.34)).toBe("12.3%");
    expect(rate(0)).toBe("0");
    expect(rate(0.004)).toBe("<0.01");
    expect(rate(1.5)).toBe("1.50");
  });
  it("describes components", () => {
    expect(component("plugin:woocommerce")).toEqual({ name: "woocommerce", kind: "Plugin" });
    expect(component("theme:astra")).toEqual({ name: "astra", kind: "Theme" });
    expect(component("core")).toEqual({ name: "WordPress core", kind: "Core" });
  });
  it("formats relative time", () => {
    expect(ago(null)).toBe("Never");
    expect(ago(1000, 31_000)).toBe("30 s ago");
    expect(ago(1, 5 * 60_000 + 1)).toBe("5 min ago");
  });
  it("marks spans over 5% and 25% of the transaction", () => {
    expect(shareLevel(5)).toBe("normal");
    expect(shareLevel(5.1)).toBe("notable");
    expect(shareLevel(25)).toBe("notable");
    expect(shareLevel(25.1)).toBe("high");
  });
  it("builds the wp-config.php snippet", () => {
    expect(wpConfigSnippet("https://apm.example.com", "pt_abc")).toBe(
      "define( 'PRESSTRACE_APP_URL', 'https://apm.example.com' );\ndefine( 'PRESSTRACE_SITE_KEY', 'pt_abc' );",
    );
  });
});

describe("theme contrast (WCAG 2.2 AA)", () => {
  const css = readFileSync(new URL("../../src/web/styles.css", import.meta.url), "utf8");
  const tokens = (selector: string) =>
    Object.fromEntries(
      [...css.split(`${selector} {`)[1]!.split("}")[0]!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]),
    );
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };
  const text: [string, string][] = [
    ["fg", "bg"], ["fg", "surface"], ["fg", "surface-2"], ["muted", "surface"], ["muted", "bg"], ["muted", "surface-2"],
    ["accent", "surface"], ["accent", "bg"], ["accent-fg", "accent"], ["warn", "surface"], ["danger", "surface"], ["ok", "surface"],
    ["danger", "danger-soft"], ["warn", "warn-soft"], ["fg", "warn-soft"], ["sev-high-fg", "sev-high-bg"], ["sev-medium-fg", "sev-medium-bg"],
    ["sev-low-fg", "sev-low-bg"],
  ];
  const graphics: [string, string][] = [
    ["c-php", "surface"], ["c-db", "surface"], ["c-http", "surface"], ["c-other", "surface"], ["border-strong", "surface"],
    ["warn", "surface-2"], ["danger", "surface-2"], ["c-php", "surface-2"], ["c-db", "surface-2"], ["c-http", "surface-2"], ["focus", "surface"],
  ];
  for (const theme of [":root", ".dark"]) {
    it(`${theme} text is at least 4.5:1 and graphics at least 3:1`, () => {
      const t = tokens(theme);
      for (const [a, b] of text) expect(ratio(t[a]!, t[b]!), `${theme} ${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
      for (const [a, b] of graphics) expect(ratio(t[a]!, t[b]!), `${theme} ${a} on ${b}`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("safeNext", () => {
  const origin = "https://apm.example.com";
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeNext("/sites/abc/issues?range=1h#top", origin)).toBe("/sites/abc/issues?range=1h#top");
    expect(safeNext("/", origin)).toBe("/");
  });
  it("falls back to / for anything that could leave the app", () => {
    for (const next of [null, "", "//evil.example/x", "/\\evil.example/x", "\\\\evil.example", "https://evil.example/x", "javascript:alert(1)", "/\t/evil.example", "sites/abc", "/%5C%5Cevil.example"]) {
      expect(safeNext(next, origin), String(next)).toBe(next === "/%5C%5Cevil.example" ? "/%5C%5Cevil.example" : "/");
    }
  });
});
