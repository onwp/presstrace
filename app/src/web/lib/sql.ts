const BREAK_BEFORE = [
  "ON DUPLICATE KEY UPDATE",
  "GROUP BY",
  "ORDER BY",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "STRAIGHT_JOIN",
  "SELECT",
  "FROM",
  "WHERE",
  "HAVING",
  "LIMIT",
  "JOIN",
  "SET",
  "VALUES",
  "UNION",
];
const INDENT_BEFORE = ["AND", "OR"];

function breakClauses(code: string): string {
  let s = code.replace(/\s+/g, " ");
  for (const kw of BREAK_BEFORE) {
    // A bare JOIN must not split "LEFT JOIN" and friends that were already broken.
    const guard = kw === "JOIN" ? "(?<!\\b(?:LEFT|RIGHT|INNER|CROSS|OUTER))" : "";
    s = s.replace(new RegExp(`${guard}\\s+(${kw.replace(/ /g, "\\s+")})\\b`, "gi"), "\n$1");
  }
  for (const kw of INDENT_BEFORE) {
    s = s.replace(new RegExp(`\\s+(${kw})\\b`, "gi"), "\n  $1");
  }
  return s;
}

/** Puts the main SQL clauses on their own lines. String literals are kept as they are. */
export function formatSql(sql: string): string {
  let out = "";
  let code = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"' || c === "`") {
      out += breakClauses(code);
      code = "";
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j += sql[j] === "\\" ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  out += breakClauses(code);
  return out.trim();
}
