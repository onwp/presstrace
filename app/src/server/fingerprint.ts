/**
 * SQL fingerprinting: turns a concrete query into a normalized shape so that
 * queries that differ only in literal values group together.
 *
 * - string and numeric literals become `?`
 * - `IN (...)` lists and multi-row `VALUES` collapse to one placeholder group
 * - comments are removed, whitespace collapses to single spaces
 * - keywords and common functions are upper-cased, identifiers keep their case
 * - backticks around identifiers are removed
 */

const KEYWORDS = new Set(
  `select from where and or not in is null like between exists as on join left right inner outer cross straight_join
  natural group by order having limit offset asc desc distinct sql_calc_found_rows sql_no_cache high_priority
  insert into values value update set delete replace ignore low_priority duplicate key union all case when then else end
  create table temporary alter drop index show tables columns full describe explain truncate using force use with
  regexp rlike div mod xor interval true false for lock share mode start transaction commit rollback any some escape
  binary collate primary unique default if`
    .split(/\s+/)
    .filter(Boolean),
);

const FUNCTIONS = new Set(
  `count sum min max avg concat concat_ws ifnull isnull coalesce lower upper length char_length now curdate curtime
  date date_format date_add date_sub unix_timestamp from_unixtime cast convert found_rows greatest least substring
  substring_index trim replace round floor ceil abs rand md5 sha1 group_concat field find_in_set lcase ucase nullif
  last_insert_id year month day hour minute second timestampdiff datediff`
    .split(/\s+/)
    .filter(Boolean),
);

type TokenType = "word" | "kw" | "fn" | "lit" | "punct" | "op";
interface Token {
  t: TokenType;
  v: string;
  /** Whether whitespace or a comment preceded the token in the source. */
  ws?: boolean;
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isWordStart = (c: string | undefined) => c !== undefined && /[A-Za-z_$@\u0080-￿]/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$@\u0080-￿]/.test(c);

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  const n = sql.length;
  let i = 0;
  let gap = false;
  const prevSignificant = () => out[out.length - 1];
  const push = (tok: Token) => {
    tok.ws = gap;
    gap = false;
    out.push(tok);
  };

  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];

    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      gap = true;
      i++;
      continue;
    }
    // Block comment (including optimizer hints).
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      gap = true;
      continue;
    }
    // Line comments: "-- " and "#".
    if ((c === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]!))) || c === "#") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      gap = true;
      continue;
    }
    // String literals with backslash and doubled-quote escapes.
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        const d = sql[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      push({ t: "lit", v: "?" });
      continue;
    }
    // Quoted identifier.
    if (c === "`") {
      const end = sql.indexOf("`", i + 1);
      const name = sql.slice(i + 1, end === -1 ? n : end);
      i = end === -1 ? n : end + 1;
      push({ t: "word", v: name });
      continue;
    }
    // Numbers, including a sign when it is unary.
    const prev = prevSignificant();
    const unaryContext = !prev || prev.t === "op" || prev.t === "kw" || (prev.t === "punct" && prev.v !== ")");
    if (
      isDigit(c) ||
      (c === "." && isDigit(next) && !(prev && (prev.t === "word" || prev.t === "fn"))) ||
      ((c === "-" || c === "+") && unaryContext && (isDigit(next) || (next === "." && isDigit(sql[i + 2]))))
    ) {
      let j = i;
      if (c === "-" || c === "+") j++;
      if (sql[j] === "0" && (sql[j + 1] === "x" || sql[j + 1] === "X")) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(sql[j]!)) j++;
      } else {
        while (j < n && (isDigit(sql[j]) || sql[j] === ".")) j++;
        if ((sql[j] === "e" || sql[j] === "E") && (isDigit(sql[j + 1]) || ((sql[j + 1] === "-" || sql[j + 1] === "+") && isDigit(sql[j + 2])))) {
          j += 2;
          while (j < n && isDigit(sql[j])) j++;
        }
      }
      // A digit run glued to letters is an identifier such as 2fa_codes.
      if (isWordChar(sql[j]) && !(c === "-" || c === "+")) {
        let k = j;
        while (k < n && isWordChar(sql[k])) k++;
        push({ t: "word", v: sql.slice(i, k) });
        i = k;
        continue;
      }
      push({ t: "lit", v: "?" });
      i = j;
      continue;
    }
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordChar(sql[j])) j++;
      const word = sql.slice(i, j);
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) push({ t: "kw", v: word.toUpperCase() });
      else if (FUNCTIONS.has(lower) && sql.slice(j).trimStart().startsWith("(")) push({ t: "fn", v: word.toUpperCase() });
      else push({ t: "word", v: word });
      i = j;
      continue;
    }
    if ("<>=!|&:".includes(c)) {
      let j = i + 1;
      while (j < n && "<>=!|&:".includes(sql[j]!)) j++;
      push({ t: "op", v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/%^~".includes(c)) {
      push({ t: c === "*" ? "punct" : "op", v: c });
      i++;
      continue;
    }
    if (c === ";") {
      i++;
      continue;
    }
    push({ t: "punct", v: c });
    i++;
  }
  return out;
}

function join(tokens: Token[]): string {
  let s = "";
  let prev: Token | undefined;
  for (const tok of tokens) {
    if (prev) {
      const noSpace =
        tok.v === "," ||
        tok.v === ")" ||
        tok.v === "." ||
        prev.v === "(" ||
        prev.v === "." ||
        (tok.v === "(" && (prev.t === "fn" || (prev.t === "word" && !tok.ws)));
      if (!noSpace) s += " ";
    }
    s += tok.v;
    prev = tok;
  }
  return s;
}

export function fingerprintSql(sql: string): string {
  let fp = join(tokenize(sql));
  // IN (?, ?, ?) -> IN (...)
  fp = fp.replace(/\bIN \((?:\?|NULL)(?:, (?:\?|NULL))*\)/g, "IN (...)");
  // VALUES (...), (...), (...) -> VALUES (...) keeping the first row shape.
  fp = fp.replace(/\b(VALUES?) (\([^()]*\))(?:, \([^()]*\))+/g, "$1 $2");
  return fp;
}

/** The first table name in a fingerprint, used for WordPress-specific advice. */
export function primaryTable(fp: string): string | null {
  const m = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z0-9_$.]+)/.exec(fp);
  return m ? m[1]! : null;
}

export function isSelectStar(fp: string): boolean {
  return /^SELECT (?:SQL_CALC_FOUND_ROWS |DISTINCT |SQL_NO_CACHE |HIGH_PRIORITY )*(?:[A-Za-z0-9_$]+\.)?\*(?: |,|$)/.test(fp);
}
