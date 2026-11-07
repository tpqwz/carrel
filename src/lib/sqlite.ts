import { lit, qid, safeName } from "@/lib/sql";

type SqlValue = string | number | Uint8Array | null;

type Statement = {
  step(): boolean;
  get(): SqlValue[];
  free(): void;
};

type SqlDatabase = {
  prepare(sql: string): Statement;
  close(): void;
};

type SqlJs = {
  Database: new (data?: Uint8Array) => SqlDatabase;
};

const BATCH = 200;

let sqlJsPromise: Promise<SqlJs> | null = null;

function sqlJs(): Promise<SqlJs> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasm = (await import("sql.js/dist/sql-wasm-browser.wasm?url")).default as string;
      const mod = await import("sql.js");
      const init = mod.default;
      return init({
        locateFile: () => new URL(wasm, window.location.href).href,
      });
    })();
  }
  return sqlJsPromise;
}

function duckType(sqliteType: string): string {
  const t = sqliteType.toUpperCase();
  if (t.includes("BOOL")) return "BOOLEAN";
  if (t.includes("INT")) return "BIGINT";
  if (/REAL|FLOA|DOUB|DEC|NUM/.test(t)) return "DOUBLE";
  if (t.includes("BLOB")) return "BLOB";
  return "VARCHAR";
}

function literal(value: SqlValue, type: string): string {
  if (value == null) return "NULL";
  if (value instanceof Uint8Array) {
    if (type === "BLOB") {
      let hex = "";
      for (const byte of value) hex += byte.toString(16).padStart(2, "0");
      return `X'${hex}'`;
    }
    return lit(new TextDecoder().decode(value));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    if (type === "BOOLEAN") return value ? "TRUE" : "FALSE";
    if (type === "VARCHAR") return lit(String(value));
    return String(value);
  }
  if (type === "BOOLEAN") {
    const text = value.toLowerCase();
    if (text === "1" || text === "true") return "TRUE";
    if (text === "0" || text === "false") return "FALSE";
  }
  if (type === "BIGINT" && /^-?\d+$/.test(value)) return value;
  if (type === "DOUBLE" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return value;
  return lit(value);
}

function readAll(db: SqlDatabase, sql: string): SqlValue[][] {
  const statement = db.prepare(sql);
  const rows: SqlValue[][] = [];
  while (statement.step()) rows.push(statement.get());
  statement.free();
  return rows;
}

export async function importSqlite(
  bytes: Uint8Array,
  query: (sql: string) => Promise<unknown>,
  taken: Set<string>,
): Promise<string[]> {
  const SQL = await sqlJs();
  const db = new SQL.Database(bytes);
  const created: string[] = [];
  try {
    const tables = readAll(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row) => String(row[0]));
    if (!tables.length) throw new Error("That SQLite file has no tables.");
    for (const name of tables) {
      let dest = safeName(name);
      while (taken.has(dest) || created.includes(dest)) dest = `${dest}_2`;
      const info = readAll(db, `PRAGMA table_info(${qid(name)})`);
      const columns = info
        .map((row) => ({
          name: String(row[1]),
          type: duckType(row[2] == null ? "" : String(row[2])),
        }))
        .filter((column) => column.name);
      if (!columns.length) continue;
      await query(
        `CREATE TABLE ${qid(dest)} (${columns
          .map((column) => `${qid(column.name)} ${column.type}`)
          .join(", ")})`,
      );
      const select = db.prepare(`SELECT * FROM ${qid(name)}`);
      let batch: SqlValue[][] = [];
      const flush = async () => {
        if (!batch.length) return;
        const values = batch
          .map(
            (row) =>
              `(${columns.map((column, index) => literal(row[index] ?? null, column.type)).join(", ")})`,
          )
          .join(", ");
        batch = [];
        await query(
          `INSERT INTO ${qid(dest)} (${columns.map((column) => qid(column.name)).join(", ")}) VALUES ${values}`,
        );
      };
      while (select.step()) {
        batch.push(select.get());
        if (batch.length >= BATCH) await flush();
      }
      select.free();
      await flush();
      created.push(dest);
    }
  } finally {
    db.close();
  }
  if (!created.length) throw new Error("That SQLite file has no tables.");
  return created;
}
