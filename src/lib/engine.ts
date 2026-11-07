import { SAMPLE_DATABASES } from "@/lib/samples";
import { cellText } from "@/lib/sql";

export type CatalogDb = { id: string; name: string; path: string; seed: boolean };

const DEFAULT_DB: CatalogDb = {
  id: SAMPLE_DATABASES[0].id,
  name: SAMPLE_DATABASES[0].name,
  path: SAMPLE_DATABASES[0].path,
  seed: true,
};

const SHIPPED: CatalogDb[] = SAMPLE_DATABASES.map((item) => ({
  id: item.id,
  name: item.name,
  path: item.path,
  seed: true,
}));

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
};

type Session = {
  query: (sql: string) => Promise<QueryResult>;
  register: (name: string, bytes: Uint8Array) => Promise<void>;
  checkpoint: () => Promise<void>;
  persisted: boolean;
  persistError: string;
};

type Live = { close: () => Promise<void> };

let sessionPromise: Promise<Session> | null = null;
let live: Live | null = null;
let detachPersist: (() => void) | null = null;

export async function resetSession(): Promise<void> {
  detachPersist?.();
  detachPersist = null;
  sessionPromise = null;
  const current = live;
  live = null;
  if (!current) return;
  try {
    await current.close();
  } catch {
    // The worker may already be gone.
  }
}

export function getSession(): Promise<Session> {
  if (!sessionPromise) sessionPromise = boot();
  return sessionPromise;
}

function storedItem(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function absolute(url: string): string {
  return new URL(url, window.location.href).href;
}

function asNumber(value: string): number | null {
  const bare = value.trim().replace(/^"(.*)"$/, "$1");
  if (!/^-?\d+(\.\d+)?$/.test(bare)) return null;
  const n = Number(bare);
  return Number.isFinite(n) ? n : null;
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const n = asNumber(value);
    return n == null ? value : n;
  }
  if (value && typeof value === "object") {
    const text = String(value);
    const n = asNumber(text);
    if (n != null) return n;
  }
  if (ArrayBuffer.isView(value)) return cellText(value);
  return value;
}

async function boot(): Promise<Session> {
  const duckdb = await import("@duckdb/duckdb-wasm");
  const mvpWasm = (await import("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url")).default;
  const mvpWorker = (await import("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url"))
    .default;
  const ehWasm = (await import("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url")).default;
  const ehWorker = (await import("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"))
    .default;

  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: absolute(mvpWasm), mainWorker: absolute(mvpWorker) },
    eh: { mainModule: absolute(ehWasm), mainWorker: absolute(ehWorker) },
  });

  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  live = {
    close: async () => {
      try {
        await db.terminate();
      } catch {
        worker.terminate();
      }
    },
  };

  try {
    await withTimeout(db.instantiate(bundle.mainModule), 12000, "The analytical engine did not start.");
    let persisted = false;
    let persistError = "";
    try {
      await withTimeout(
        db.open({
          path: currentDatabase().path,
          accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        }),
        4000,
        "Saved storage did not answer.",
      );
      persisted = true;
    } catch (err) {
      persistError = err instanceof Error ? err.message : "storage unavailable";
    }
    const conn = await db.connect();

    async function checkpoint() {
      try {
        await conn.query("CHECKPOINT");
      } catch {
        // Memory mode has nothing to flush.
      }
      try {
        await db.flushFiles();
      } catch {
        // Ignore a missing filesystem.
      }
    }

    const onHide = () => {
      void checkpoint();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    detachPersist = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };

    const countMeta = await conn.query(
      `SELECT count(*)::INTEGER AS n FROM information_schema.tables
       WHERE table_schema = 'main' AND table_name = '_desk_meta'`,
    );
    let seeded = false;
    for (const row of countMeta) {
      seeded = Number((row.toJSON() as { n?: unknown }).n ?? 0) > 0;
    }
    if (!seeded && currentDatabase().seed) {
      const sample = SAMPLE_DATABASES.find((item) => item.path === currentDatabase().path);
      const countTables = await conn.query(
        `SELECT count(*)::INTEGER AS n FROM information_schema.tables WHERE table_schema = 'main'`,
      );
      let existing = 0;
      for (const row of countTables) {
        existing = Number((row.toJSON() as { n?: unknown }).n ?? 0);
      }
      if (sample && existing === 0) {
        for (const statement of sample.sql) await conn.query(statement);
      }
      await conn.query("CREATE TABLE IF NOT EXISTS _desk_meta (k VARCHAR PRIMARY KEY, v VARCHAR)");
      await conn.query(
        `INSERT INTO _desk_meta
         SELECT 'seeded', '1'
         WHERE NOT EXISTS (SELECT 1 FROM _desk_meta WHERE k = 'seeded')`,
      );
      await checkpoint();
    }

    return {
      persisted,
      persistError,
      async checkpoint() {
        await checkpoint();
      },
      async query(sql: string): Promise<QueryResult> {
        const started = performance.now();
        const table = await conn.query(sql);
        const columns = table.schema.fields.map((field) => field.name);
        const rows: Record<string, unknown>[] = [];
        for (const row of table) {
          const json = row.toJSON() as Record<string, unknown>;
          const next: Record<string, unknown> = {};
          for (const column of columns) next[column] = normalize(json[column]);
          rows.push(next);
        }
        return { columns, rows, ms: Math.round(performance.now() - started) };
      },
      async register(name: string, bytes: Uint8Array) {
        const copy = new Uint8Array(bytes);
        await db.registerFileBuffer(name, copy);
      },
    };
  } catch (err) {
    await resetSession();
    throw err;
  }
}

function readCatalog(): CatalogDb[] {
  if (typeof localStorage === "undefined") return SHIPPED;
  let stored: CatalogDb[] = [];
  try {
    const raw = localStorage.getItem("carrel.catalog");
    const parsed = raw ? (JSON.parse(raw) as CatalogDb[]) : [];
    if (Array.isArray(parsed)) {
      stored = parsed.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.path === "string" &&
          item.path.startsWith("opfs://"),
      );
    }
  } catch {
    stored = [];
  }
  const known = new Set(stored.map((item) => item.id));
  const merged = [...stored];
  for (const sample of SHIPPED) {
    if (!known.has(sample.id)) merged.push(sample);
  }
  return merged.length ? merged : SHIPPED;
}

export function listDatabases(): CatalogDb[] {
  const items = readCatalog();
  return items.length ? items : [DEFAULT_DB];
}

export function currentDatabase(): CatalogDb {
  const items = listDatabases();
  const id = storedItem("carrel.active") || "main";
  return items.find((item) => item.id === id) ?? items[0];
}

export async function openDatabase(id: string): Promise<void> {
  if (!listDatabases().some((item) => item.id === id)) throw new Error("No such database");
  localStorage.setItem("carrel.active", id);
  await resetSession();
}

export async function createDatabase(name: string): Promise<CatalogDb> {
  const label = name.trim() || "Untitled";
  const id = `db_${Date.now().toString(36)}`;
  const next: CatalogDb = { id, name: label, path: `opfs://${id}.db`, seed: false };
  const items = [...listDatabases(), next];
  localStorage.setItem("carrel.catalog", JSON.stringify(items));
  localStorage.setItem("carrel.active", id);
  await resetSession();
  return next;
}
