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
  exportBytes: () => Promise<Uint8Array>;
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

function snapshotName(id: string): string {
  return `carrel-snap-${id}.duckdb`;
}

function isDuckFile(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 12 &&
    bytes[8] === 0x44 &&
    bytes[9] === 0x55 &&
    bytes[10] === 0x43 &&
    bytes[11] === 0x4b
  );
}

async function readSnapshot(id: string): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(snapshotName(id));
    const file = await handle.getFile();
    if (file.size < 32) return null;
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(snapshotName(id), { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Uint8Array(bytes));
  await writable.close();
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
        12000,
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
      try {
        const count = await conn.query(
          `SELECT count(*)::INTEGER AS n FROM information_schema.tables
           WHERE table_schema = 'main' AND table_type = 'BASE TABLE'`,
        );
        let tables = 0;
        for (const row of count) tables = Number((row.toJSON() as { n?: unknown }).n ?? 0);
        if (!tables) return;
        const bare = currentDatabase().path.replace(/^opfs:\/\//, "");
        const names = [currentDatabase().path, `opfs:/${bare}`, bare];
        let best: Uint8Array | null = null;
        for (const name of names) {
          try {
            const bytes = await db.copyFileToBuffer(name);
            if (bytes && (!best || bytes.byteLength > best.byteLength)) best = bytes;
          } catch {
            // Try the next filename. DuckDB-WASM does not always use the path we opened.
          }
        }
        if (best && isDuckFile(best)) await writeSnapshot(currentDatabase().id, best);
      } catch {
        // A failed snapshot should not undo the query that just succeeded.
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
    const countTables = await conn.query(
      `SELECT count(*)::INTEGER AS n FROM information_schema.tables WHERE table_schema = 'main'`,
    );
    let existing = 0;
    for (const row of countTables) {
      existing = Number((row.toJSON() as { n?: unknown }).n ?? 0);
    }
    if (existing === 0) {
      const snap = await readSnapshot(currentDatabase().id);
      const sample = SAMPLE_DATABASES.find((item) => item.path === currentDatabase().path);
      if (snap && isDuckFile(snap)) {
        await db.registerFileBuffer("carrel_snap.duckdb", snap);
        await conn.query("ATTACH 'carrel_snap.duckdb' AS carrel_src (READ_ONLY)");
        const listed = await conn.query(
          "SELECT table_name FROM duckdb_tables() WHERE database_name = 'carrel_src'",
        );
        for (const row of listed) {
          const table = (row.toJSON() as { table_name?: string }).table_name;
          if (!table) continue;
          const quoted = `"${table.replaceAll('"', '""')}"`;
          await conn.query(`CREATE TABLE ${quoted} AS SELECT * FROM carrel_src.${quoted}`);
        }
        await conn.query("DETACH carrel_src");
        await checkpoint();
      } else if (!seeded && currentDatabase().seed && sample) {
        for (const statement of sample.sql) await conn.query(statement);
        await conn.query("CREATE TABLE IF NOT EXISTS _desk_meta (k VARCHAR PRIMARY KEY, v VARCHAR)");
        await conn.query(
          `INSERT INTO _desk_meta
           SELECT 'seeded', '1'
           WHERE NOT EXISTS (SELECT 1 FROM _desk_meta WHERE k = 'seeded')`,
        );
        await checkpoint();
      }
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
      async exportBytes() {
        await checkpoint();
        const path = currentDatabase().path;
        const bare = path.replace(/^opfs:\/\//, "");
        const names = [path, `opfs:/${bare}`, bare];
        try {
          const listed = await db.globFiles("*");
          for (const file of listed) {
            if (file.fileName?.includes(bare) && !names.includes(file.fileName)) names.push(file.fileName);
          }
        } catch {
          // The known path is enough when the file list is unavailable.
        }
        let last = "This database is not a file yet.";
        for (const name of names) {
          try {
            const bytes = await db.copyFileToBuffer(name);
            if (bytes && bytes.byteLength > 16) return bytes;
          } catch (err) {
            last = err instanceof Error ? err.message : last;
          }
        }
        throw new Error(last);
      },
    };
  } catch (err) {
    await resetSession();
    throw err;
  }
}

function dismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem("carrel.dismissed");
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCatalog(items: CatalogDb[]) {
  localStorage.setItem("carrel.catalog", JSON.stringify(items));
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
  const dismissed = dismissedIds();
  const merged = stored.filter((item) => !dismissed.has(item.id));
  const known = new Set(merged.map((item) => item.id));
  for (const sample of SHIPPED) {
    if (!known.has(sample.id) && !dismissed.has(sample.id)) merged.push(sample);
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

export function renameDatabase(id: string, name: string): CatalogDb[] {
  const label = name.trim();
  if (!label) throw new Error("Name it first.");
  const items = listDatabases();
  if (!items.some((item) => item.id === id)) throw new Error("No such database.");
  const next = items.map((item) => (item.id === id ? { ...item, name: label } : item));
  saveCatalog(next);
  return next;
}

export async function removeDatabase(id: string): Promise<CatalogDb[]> {
  const items = listDatabases();
  const target = items.find((item) => item.id === id);
  if (!target) throw new Error("No such database.");
  if (items.length < 2) throw new Error("Keep at least one database.");
  const next = items.filter((item) => item.id !== id);
  const dismissed = dismissedIds();
  dismissed.add(id);
  localStorage.setItem("carrel.dismissed", JSON.stringify([...dismissed]));
  saveCatalog(next);
  const active = storedItem("carrel.active");
  if (!active || active === id) {
    localStorage.setItem("carrel.active", next[0].id);
    await resetSession();
  }
  try {
    const root = await navigator.storage.getDirectory();
    const fileName = target.path.replace(/^opfs:\/\//, "");
    for (const name of [snapshotName(id), fileName, `${fileName}.wal`]) {
      try {
        await root.removeEntry(name);
      } catch {
        // The file may never have been written.
      }
    }
  } catch {
    // The name is already gone from the list.
  }
  return next;
}

export async function adoptDatabase(name: string, bytes: Uint8Array): Promise<CatalogDb> {
  const created = await createDatabase(name);
  const session = await getSession();
  await session.register("incoming.duckdb", bytes);
  await session.query("ATTACH 'incoming.duckdb' AS carrel_src (READ_ONLY)");
  const listed = await session.query(
    "SELECT table_name FROM duckdb_tables() WHERE database_name = 'carrel_src'",
  );
  const tables = listed.rows.map((row) => String(row.table_name ?? "")).filter(Boolean);
  if (!tables.length) throw new Error("That file has no tables.");
  for (const table of tables) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    await session.query(`CREATE TABLE ${quoted} AS SELECT * FROM carrel_src.${quoted}`);
  }
  await session.query("DETACH carrel_src");
  await session.checkpoint();
  return created;
}
