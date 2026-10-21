import { describe, expect, it } from "vitest";
import { fingerprintSql, isSelectStar, primaryTable } from "../../src/server/fingerprint";

describe("fingerprintSql", () => {
  it("replaces string and numeric literals", () => {
    expect(fingerprintSql("SELECT * FROM wp_posts WHERE ID = 42 AND post_status = 'publish'")).toBe(
      "SELECT * FROM wp_posts WHERE ID = ? AND post_status = ?",
    );
  });

  it("groups queries that differ only in literal values", () => {
    const a = fingerprintSql("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
    const b = fingerprintSql("select option_value from wp_options where option_name = 'home' limit 1");
    expect(a).toBe(b);
  });

  it("normalizes keyword case but keeps identifier case", () => {
    expect(fingerprintSql("select ID, post_title from WP_POSTS")).toBe("SELECT ID, post_title FROM WP_POSTS");
  });

  it("collapses whitespace and newlines", () => {
    expect(fingerprintSql("SELECT  a\n\t FROM   t\r\nWHERE  b=1")).toBe("SELECT a FROM t WHERE b = ?");
  });

  it("collapses IN lists of any length", () => {
    const short = fingerprintSql("SELECT * FROM wp_postmeta WHERE post_id IN (1)");
    const long = fingerprintSql("SELECT * FROM wp_postmeta WHERE post_id IN (1, 2, 3, 'x', NULL)");
    expect(short).toBe("SELECT * FROM wp_postmeta WHERE post_id IN (...)");
    expect(long).toBe(short);
  });

  it("collapses multi-row VALUES", () => {
    expect(fingerprintSql("INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y'), (3, 'z')")).toBe(
      "INSERT INTO t (a, b) VALUES (?, ?)",
    );
  });

  it("handles escaped quotes inside strings", () => {
    expect(fingerprintSql("SELECT 1 FROM t WHERE a = 'it\\'s' AND b = 'o''neil' AND c = \"q\"")).toBe(
      "SELECT ? FROM t WHERE a = ? AND b = ? AND c = ?",
    );
  });

  it("handles negative, decimal, exponent and hex numbers", () => {
    expect(fingerprintSql("SELECT * FROM t WHERE a = -5 AND b > 3.14 AND c < 1e10 AND d = 0xFF")).toBe(
      "SELECT * FROM t WHERE a = ? AND b > ? AND c < ? AND d = ?",
    );
  });

  it("keeps digits that are part of identifiers", () => {
    expect(fingerprintSql("SELECT * FROM wp_2_posts WHERE ID = 7")).toBe("SELECT * FROM wp_2_posts WHERE ID = ?");
  });

  it("removes backticks, comments and trailing semicolons", () => {
    expect(fingerprintSql("SELECT `ID` /* hint */ FROM `wp_posts` -- tail comment\nWHERE `ID` = 3; # done")).toBe(
      "SELECT ID FROM wp_posts WHERE ID = ?",
    );
  });

  it("formats function calls and qualified names compactly", () => {
    expect(fingerprintSql("select count( * ) from wp_posts p where p . ID > 10")).toBe(
      "SELECT COUNT(*) FROM wp_posts p WHERE p.ID > ?",
    );
  });

  it("treats binary minus as an operator", () => {
    expect(fingerprintSql("SELECT a - 1 FROM t")).toBe("SELECT a - ? FROM t");
  });

  it("does not throw on truncated SQL with an open string", () => {
    expect(fingerprintSql("SELECT * FROM t WHERE a = 'unterminated")).toBe("SELECT * FROM t WHERE a = ?");
  });

  it("normalizes LIMIT offsets", () => {
    expect(fingerprintSql("SELECT ID FROM wp_posts LIMIT 0, 10")).toBe("SELECT ID FROM wp_posts LIMIT ?, ?");
  });
});

describe("helpers", () => {
  it("finds the primary table", () => {
    expect(primaryTable("SELECT * FROM wp_postmeta WHERE post_id IN (...)")).toBe("wp_postmeta");
    expect(primaryTable("UPDATE wp_options SET option_value = ?")).toBe("wp_options");
    expect(primaryTable("SHOW TABLES")).toBeNull();
  });

  it("detects SELECT *", () => {
    expect(isSelectStar("SELECT * FROM t")).toBe(true);
    expect(isSelectStar("SELECT SQL_CALC_FOUND_ROWS wp_posts.* FROM wp_posts")).toBe(true);
    expect(isSelectStar("SELECT ID FROM t")).toBe(false);
    expect(isSelectStar("SELECT COUNT(*) FROM t")).toBe(false);
  });
});
