export function qid(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function safeName(raw: string): string {
  const base = raw
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!base || /^[0-9]/.test(base)) return `t_${base || "data"}`;
  return base;
}

export function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          current += sql[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

export function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function isNumericType(type: string): boolean {
  return /INT|DOUBLE|FLOAT|DECIMAL|REAL|HUGEINT|NUMERIC/i.test(type);
}

export function valueSql(text: string, type = ""): string {
  const trimmed = text.trim();
  if (!trimmed) return "NULL";
  if (/BOOL/i.test(type)) {
    if (/^(1|true|yes)$/i.test(trimmed)) return "TRUE";
    if (/^(0|false|no)$/i.test(trimmed)) return "FALSE";
  }
  if ((!type || isNumericType(type)) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return trimmed;
  if (/^(true|false)$/i.test(trimmed) && !type) return trimmed.toUpperCase();
  return lit(trimmed);
}

export function namedParams(sql: string): string[] {
  const names: string[] = [];
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (/[A-Za-z0-9_]/.test(sql[j] ?? "")) j += 1;
      const name = sql.slice(i + 1, j);
      if (!names.includes(name)) names.push(name);
      i = j - 1;
    }
  }
  return names;
}

export function bindNamed(sql: string, values: Record<string, string>): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i += 1;
        } else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (/[A-Za-z0-9_]/.test(sql[j] ?? "")) j += 1;
      out += valueSql(values[sql.slice(i + 1, j)] ?? "");
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function looksLikeJson(value: string): boolean {
  const t = value.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}
