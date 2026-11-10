import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Map as MapIcon,
  Play,
  Settings,
  Table2,
  Upload,
} from "lucide-react";
import { adoptDatabase, createDatabase, currentDatabase, getSession, listDatabases, openDatabase, removeDatabase, renameDatabase, resetSession, type CatalogDb, type QueryResult } from "@/lib/engine";
import { importSqlite } from "@/lib/sqlite";
import { CANNED, SAMPLE_DATABASES } from "@/lib/samples";
import { bindNamed, cellText, isNumericType, looksLikeJson, lit, namedParams, qid, safeName, splitSql, valueSql } from "@/lib/sql";

type Column = { name: string; type: string };
type TableMeta = { name: string; rows: number; columns: Column[] };
type View = "browse" | "query" | "chart" | "map" | "settings";
type FacetValue = { value: string | null; n: number };
type ChartKind = "bar" | "line";
type RuleOp = "eq" | "contains" | "gt" | "lt" | "empty" | "notempty";
type Rule = { id: number; column: string; op: RuleOp; value: string };
type TableNotes = { about: string; source: string; license: string };
type ForeignKey = { column: string; table: string };
type SavedQuery = { name: string; sql: string };
type HistoryItem = { at: string; sql: string; ok: boolean };
type UndoEntry =
  | { kind: "cell"; table: string; rowid: number; column: string; previous: string }
  | { kind: "delete"; table: string; values: Record<string, string> }
  | { kind: "insert"; table: string; rowid: number };
type ColumnProfile = {
  column: string;
  type: string;
  n: number;
  empty: number;
  distinct: number;
  min: string;
  max: string;
  top: { value: string; n: number }[];
};

const PAGE = 40;
const EXPORT_CAP = 20000;

type MapPoint = { lat: number; lon: number; title: string; detail: string };

export function Desk() {
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
  const [error, setError] = useState("");
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [table, setTable] = useState("cities");
  const [view, setView] = useState<View>("browse");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ column: string; dir: "ASC" | "DESC" } | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [facets, setFacets] = useState<Record<string, FacetValue[]>>({});
  const [grid, setGrid] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState(0);
  const [sql, setSql] = useState(CANNED[0]?.sql ?? "SELECT 1");
  const [sqlResult, setSqlResult] = useState<QueryResult | null>(null);
  const [sqlError, setSqlError] = useState("");
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [shape, setShape] = useState<"grid" | "json">("grid");
  const [undoCount, setUndoCount] = useState(0);
  const undoRef = useRef<UndoEntry[]>([]);
  const [queryName, setQueryName] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [chartX, setChartX] = useState("");
  const [chartY, setChartY] = useState("");
  const [chartKind, setChartKind] = useState<ChartKind>("bar");
  const [chartRows, setChartRows] = useState<Record<string, unknown>[]>([]);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [MapPane, setMapPane] = useState<ComponentType<{ points: MapPoint[] }> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [databases, setDatabases] = useState<CatalogDb[]>(() => listDatabases());
  const [activeDb, setActiveDb] = useState(() => currentDatabase().id);
  const [dbName, setDbName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sqlWriting, setSqlWriting] = useState(false);
  const [allowEdit, setAllowEdit] = useState(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem("carrel.allowEdit") === "1";
    } catch {
      return false;
    }
  });
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleOp, setRuleOp] = useState<RuleOp>("contains");
  const [ruleValue, setRuleValue] = useState("");
  const [openRow, setOpenRow] = useState<Record<string, unknown> | null>(null);
  const [notes, setNotes] = useState<TableNotes>({ about: "", source: "", license: "" });
  const [fks, setFks] = useState<ForeignKey[]>([]);
  const [newTable, setNewTable] = useState("notes");
  const [newColumns, setNewColumns] = useState("title VARCHAR\nbody VARCHAR");
  const [params, setParams] = useState<Record<string, string>>({});
  const paramNames = useMemo(() => namedParams(sql), [sql]);

  const meta = tables.find((item) => item.name === table) ?? tables[0];

  useEffect(() => {
    if (meta && meta.name !== table) setTable(meta.name);
  }, [meta, table]);

  async function refreshTables(prefer?: string) {
    const session = await getSession();
    const listed = await session.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const next: TableMeta[] = [];
    for (const row of listed.rows) {
      const name = String(row.table_name);
      const columns = await session.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'main' AND table_name = ${lit(name)}
         ORDER BY ordinal_position`,
      );
      const count = await session.query(`SELECT count(*)::INTEGER AS n FROM ${qid(name)}`);
      next.push({
        name,
        rows: Number(count.rows[0]?.n ?? 0),
        columns: columns.rows.map((column) => ({
          name: String(column.column_name),
          type: String(column.data_type),
        })),
      });
    }
    const visible = next.filter((item) => !item.name.startsWith("_desk_"));
    setTables(visible);
    const chosen = visible.find((item) => item.name === prefer) ?? visible[0];
    if (chosen) setTable(chosen.name);
  }

  useEffect(() => {
    let live = true;
    getSession()
      .then(async (session) => {
        await refreshTables("cities");
        await loadSaved();
        await loadHistory();
        if (live && !session.persisted) {
          const detail = session.persistError ? ` ${session.persistError}` : "";
          setNotice(`Could not keep a saved database in this browser.${detail} Tables last for this visit only.`);
        }
        if (live) setPhase("ready");
      })
      .catch((err: unknown) => {
        if (!live) return;
        resetSession();
        setError(err instanceof Error ? err.message : "The analytical engine failed to start.");
        setPhase("error");
      });
    return () => {
      live = false;
    };
    // Boot once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !meta) return;
    let live = true;
    const where = whereClause(meta, search, filters, rules);
    const order = sort
      ? ` ORDER BY ${qid(sort.column)} ${sort.dir} NULLS LAST`
      : editing
        ? " ORDER BY rowid DESC"
        : "";
    setBusy(true);
    getSession()
      .then(async (session) => {
        const counted = await session.query(
          `SELECT count(*)::INTEGER AS n FROM ${qid(meta.name)}${where}`,
        );
        const picked = editing ? "rowid AS _rowid, *" : "*";
        let browsed: QueryResult;
        try {
          browsed = await session.query(
            `SELECT ${picked} FROM ${qid(meta.name)}${where}${order} LIMIT ${PAGE} OFFSET ${page * PAGE}`,
          );
        } catch (err) {
          if (!editing) throw err;
          setEditing(false);
          setNotice("This table has no row ids, so edit it in SQL instead.");
          browsed = await session.query(
            `SELECT * FROM ${qid(meta.name)}${where} LIMIT ${PAGE} OFFSET ${page * PAGE}`,
          );
        }
        if (!live) return;
        setTotal(Number(counted.rows[0]?.n ?? 0));
        setGrid(browsed);
      })
      .catch((err: unknown) => {
        if (live) setNotice(err instanceof Error ? err.message : "Query failed");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [phase, meta, search, filters, sort, page, editing, rules]);

  useEffect(() => {
    if (phase !== "ready" || !meta) return;
    let live = true;
    const candidates = meta.columns.filter((column) => !isNumericType(column.type)).slice(0, 4);
    getSession()
      .then(async (session) => {
        const next: Record<string, FacetValue[]> = {};
        for (const column of candidates) {
          const distinct = await session.query(
            `SELECT count(DISTINCT ${qid(column.name)})::INTEGER AS n FROM ${qid(meta.name)}`,
          );
          const n = Number(distinct.rows[0]?.n ?? 0);
          if (n < 2 || n > 16) continue;
          const values = await session.query(
            `SELECT ${qid(column.name)} AS v, count(*)::INTEGER AS n
             FROM ${qid(meta.name)}
             GROUP BY 1
             ORDER BY n DESC
             LIMIT 16`,
          );
          next[column.name] = values.rows.map((row) => ({
            value: row.v == null ? null : String(row.v),
            n: Number(row.n),
          }));
        }
        if (live) setFacets(next);
      })
      .catch(() => {
        if (live) setFacets({});
      });
    return () => {
      live = false;
    };
  }, [phase, meta]);

  useEffect(() => {
    if (!meta) return;
    const text = meta.columns.find((column) => !isNumericType(column.type));
    const numeric = meta.columns.find((column) => isNumericType(column.type));
    setChartX(text?.name ?? meta.columns[0]?.name ?? "");
    setChartY(numeric?.name ?? meta.columns[1]?.name ?? "");
  }, [table, meta]);

  useEffect(() => {
    setPage(0);
    setSort(null);
    setSearch("");
    setFilters({});
    setRules([]);
    setOpenRow(null);
    setInspect(null);
    setConfirmDrop(false);
    setShape("grid");
  }, [table]);

  useEffect(() => {
    if (phase !== "ready" || !table) return;
    let live = true;
    getSession()
      .then(async (session) => {
        await session.query(
          `CREATE TABLE IF NOT EXISTS _desk_notes (
             table_name VARCHAR PRIMARY KEY,
             about VARCHAR,
             source VARCHAR,
             license VARCHAR
           )`,
        );
        const rows = await session.query(
          `SELECT about, source, license FROM _desk_notes WHERE table_name = ${lit(table)}`,
        );
        if (!live) return;
        const row = rows.rows[0];
        setNotes({
          about: cellText(row?.about),
          source: cellText(row?.source),
          license: cellText(row?.license),
        });
        try {
          const keys = await session.query(
            `SELECT constraint_text FROM duckdb_constraints()
             WHERE table_name = ${lit(table)} AND constraint_type = 'FOREIGN KEY'`,
          );
          if (!live) return;
          setFks(
            keys.rows.flatMap((item) => {
              const text = cellText(item.constraint_text);
              const match = /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s*("?)([A-Za-z_][A-Za-z0-9_]*)/i.exec(text);
              if (!match) return [];
              return [{ column: match[1].replaceAll('"', "").trim(), table: match[3] }];
            }),
          );
        } catch {
          if (live) setFks([]);
        }
      })
      .catch(() => {
        if (live) setNotes({ about: "", source: "", license: "" });
      });
    return () => {
      live = false;
    };
  }, [phase, table]);

  useEffect(() => {
    if (phase !== "ready" || !meta || !chartX || !chartY || view !== "chart") return;
    let live = true;
    const xType = meta.columns.find((column) => column.name === chartX)?.type ?? "";
    const yType = meta.columns.find((column) => column.name === chartY)?.type ?? "";
    const sqlText =
      isNumericType(xType) && isNumericType(yType)
        ? `SELECT ${qid(chartX)} AS x, ${qid(chartY)} AS y FROM ${qid(meta.name)}
           WHERE ${qid(chartX)} IS NOT NULL AND ${qid(chartY)} IS NOT NULL
           LIMIT 80`
        : `SELECT ${qid(chartX)} AS x, round(sum(${qid(chartY)}), 1) AS y
           FROM ${qid(meta.name)}
           WHERE ${qid(chartX)} IS NOT NULL
           GROUP BY 1
           ORDER BY y DESC
           LIMIT 12`;
    getSession()
      .then((session) => session.query(sqlText))
      .then((result) => {
        if (live) setChartRows(result.rows);
      })
      .catch(() => {
        if (live) setChartRows([]);
      });
    return () => {
      live = false;
    };
  }, [phase, meta, chartX, chartY, view]);

  const geo = useMemo(() => geoColumns(meta), [meta]);

  useEffect(() => {
    if (phase !== "ready" || !meta || !geo || view !== "map") return;
    let live = true;
    const label = meta.columns.find((column) => /name|title|city|artist/i.test(column.name));
    getSession()
      .then((session) =>
        session.query(
          `SELECT ${qid(geo.lat)} AS lat, ${qid(geo.lon)} AS lon,
                  ${label ? qid(label.name) : "''"} AS title
           FROM ${qid(meta.name)}
           WHERE ${qid(geo.lat)} IS NOT NULL AND ${qid(geo.lon)} IS NOT NULL
           LIMIT 400`,
        ),
      )
      .then((result) => {
        if (!live) return;
        setMapPoints(
          result.rows
            .map((row) => ({
              lat: Number(row.lat),
              lon: Number(row.lon),
              title: String(row.title || meta.name),
              detail: `${row.lat}, ${row.lon}`,
            }))
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
        );
      })
      .catch(() => {
        if (live) setMapPoints([]);
      });
    return () => {
      live = false;
    };
  }, [phase, meta, geo, view]);

  useEffect(() => {
    if (phase !== "ready" || !meta || !inspect) return;
    const column = meta.columns.find((item) => item.name === inspect);
    if (!column) return;
    let live = true;
    const quoted = qid(column.name);
    getSession()
      .then(async (session) => {
        const summary = await session.query(
          `SELECT count(*)::INTEGER AS n,
                  count(${quoted})::INTEGER AS filled,
                  count(DISTINCT ${quoted})::INTEGER AS distinct_n,
                  min(${quoted}) AS min_v,
                  max(${quoted}) AS max_v
           FROM ${qid(meta.name)}`,
        );
        const top = await session.query(
          `SELECT ${quoted} AS v, count(*)::INTEGER AS n
           FROM ${qid(meta.name)}
           GROUP BY 1
           ORDER BY n DESC
           LIMIT 6`,
        );
        if (!live) return;
        const row = summary.rows[0] ?? {};
        const n = Number(row.n ?? 0);
        const filled = Number(row.filled ?? 0);
        setProfile({
          column: column.name,
          type: column.type,
          n,
          empty: Math.max(0, n - filled),
          distinct: Number(row.distinct_n ?? 0),
          min: cellText(row.min_v),
          max: cellText(row.max_v),
          top: top.rows.map((item) => ({
            value: item.v == null || item.v === "" ? "empty" : cellText(item.v),
            n: Number(item.n),
          })),
        });
      })
      .catch(() => {
        if (live) setProfile(null);
      });
    return () => {
      live = false;
    };
  }, [phase, meta, inspect]);

  useEffect(() => {
    if (view !== "map" || MapPane) return;
    void import("@/components/map-pane").then((mod) => setMapPane(() => mod.MapPane));
  }, [view, MapPane]);

  async function runSql(text = sql) {
    setBusy(true);
    setSqlError("");
    setNotice("");
    try {
      const session = await getSession();
      const statements = splitSql(bindNamed(text, params));
      if (statements.some(isWrite) && !(allowEdit && sqlWriting)) {
        setSqlError("Writes are off. Allow editing in Settings, then turn on Writes here.");
        setBusy(false);
        return;
      }
      let last: QueryResult | null = null;
      for (const statement of statements) {
        const result = await session.query(statement);
        if (result.columns.length) last = result;
      }
      setSqlResult(last);
      if (!last) setNotice(`${statements.length} statement${statements.length === 1 ? "" : "s"} ran.`);
      await session.checkpoint();
      await rememberSql(text, true).catch(() => undefined);
      await refreshTables(table);
    } catch (err) {
      setSqlResult(null);
      setSqlError(err instanceof Error ? err.message : "Query failed");
      await rememberSql(text, false).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function loadSaved() {
    const session = await getSession();
    await session.query(
      "CREATE TABLE IF NOT EXISTS _desk_queries (name VARCHAR PRIMARY KEY, sql VARCHAR)",
    );
    const rows = await session.query("SELECT name, sql FROM _desk_queries ORDER BY name");
    setSaved(
      rows.rows.map((row) => ({
        name: String(row.name),
        sql: String(row.sql ?? ""),
      })),
    );
  }

  async function saveQuery() {
    const name = queryName.trim();
    if (!name) {
      setNotice("Name the query before saving it.");
      return;
    }
    if (!sql.trim()) return;
    setBusy(true);
    try {
      const session = await getSession();
      await session.query(
        "CREATE TABLE IF NOT EXISTS _desk_queries (name VARCHAR PRIMARY KEY, sql VARCHAR)",
      );
      await session.query(`DELETE FROM _desk_queries WHERE name = ${lit(name)}`);
      await session.query(`INSERT INTO _desk_queries VALUES (${lit(name)}, ${lit(sql)})`);
      await session.checkpoint();
      await loadSaved();
      setNotice(`Saved “${name}”.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save that query.");
    } finally {
      setBusy(false);
    }
  }

  async function forgetQuery(name: string) {
    const session = await getSession();
    await session.query(`DELETE FROM _desk_queries WHERE name = ${lit(name)}`);
    await session.checkpoint();
    await loadSaved();
  }

  async function loadHistory() {
    const session = await getSession();
    await session.query(
      "CREATE TABLE IF NOT EXISTS _desk_history (ran_at VARCHAR, sql VARCHAR, ok BOOLEAN)",
    );
    const rows = await session.query(
      "SELECT ran_at, sql, ok FROM _desk_history ORDER BY ran_at DESC LIMIT 12",
    );
    setHistory(
      rows.rows.map((row) => ({
        at: cellText(row.ran_at),
        sql: cellText(row.sql),
        ok: row.ok === true || row.ok === "true" || row.ok === 1,
      })),
    );
  }

  async function rememberSql(text: string, ok: boolean) {
    const body = text.trim().slice(0, 2000);
    if (!body) return;
    const session = await getSession();
    await session.query(
      "CREATE TABLE IF NOT EXISTS _desk_history (ran_at VARCHAR, sql VARCHAR, ok BOOLEAN)",
    );
    await session.query(
      `INSERT INTO _desk_history VALUES (${lit(new Date().toISOString())}, ${lit(body)}, ${ok ? "TRUE" : "FALSE"})`,
    );
    await session.query(
      `DELETE FROM _desk_history
       WHERE ran_at NOT IN (SELECT ran_at FROM _desk_history ORDER BY ran_at DESC LIMIT 20)`,
    );
    await session.checkpoint();
    await loadHistory();
  }

  async function dropTable() {
    if (!meta || !allowEdit || !editing) return;
    const name = meta.name;
    if (!confirmDrop) {
      setConfirmDrop(true);
      return;
    }
    const session = await getSession();
    await session.query(`DROP TABLE ${qid(name)}`);
    await session.checkpoint();
    setConfirmDrop(false);
    setOpenRow(null);
    await refreshTables();
    setNotice(`Dropped ${name}.`);
  }

  async function copyPage() {
    const result = view === "query" ? sqlResult : grid;
    if (!result?.rows.length) return;
    const columns = result.columns.filter((column) => column !== "_rowid");
    const lines = [
      columns.join("\t"),
      ...result.rows.map((row) =>
        columns.map((column) => cellText(row[column]).replaceAll(/[\t\n\r]/g, " ")).join("\t"),
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setNotice("Copied this page.");
  }

  async function restartOn(id: string, announce?: string) {
    setPhase("boot");
    setEditing(false);
    setOpenRow(null);
    try {
      await openDatabase(id);
      setActiveDb(id);
      setDatabases(listDatabases());
      await refreshTables();
      await loadSaved();
      await loadHistory();
      if (announce) setNotice(announce);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The database did not open.");
      setPhase("error");
    }
  }

  async function makeDatabase() {
    const name = dbName.trim();
    if (!name) return;
    setDbName("");
    setPhase("boot");
    try {
      const created = await createDatabase(name);
      setActiveDb(created.id);
      setDatabases(listDatabases());
      await refreshTables();
      await loadSaved();
      await loadHistory();
      setNotice(`${created.name} is empty. Create a table, or open a file.`);
      setPhase("ready");
      setView("browse");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that database.");
      setPhase("error");
    }
  }

  function renameDesk(id: string) {
    try {
      const items = renameDatabase(id, renameValue);
      setDatabases(items);
      setRenameId(null);
      setNotice("Renamed.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not rename that database.");
    }
  }

  async function removeDesk(id: string) {
    if (confirmRemove !== id) {
      setConfirmRemove(id);
      setRenameId(null);
      return;
    }
    const wasActive = activeDb === id;
    if (wasActive) setPhase("boot");
    try {
      const items = await removeDatabase(id);
      setDatabases(items);
      setConfirmRemove(null);
      if (wasActive) {
        setActiveDb(items[0].id);
        await refreshTables();
        await loadSaved();
        await loadHistory();
        setPhase("ready");
      }
      setNotice("Removed from this browser.");
      setView("settings");
    } catch (err) {
      if (wasActive) setPhase("ready");
      setNotice(err instanceof Error ? err.message : "Could not remove that database.");
    }
  }

  function pushUndo(entry: UndoEntry) {
    undoRef.current = [...undoRef.current, entry].slice(-40);
    setUndoCount(undoRef.current.length);
  }

  async function commitCell(rowid: number, column: string, text: string) {
    if (!meta) return;
    const type = meta.columns.find((item) => item.name === column)?.type ?? "";
    const previous = cellText(grid?.rows.find((row) => Number(row._rowid) === rowid)?.[column]);
    if (previous === text) return;
    try {
      const session = await getSession();
      await session.query(
        `UPDATE ${qid(meta.name)} SET ${qid(column)} = ${valueSql(text, type)} WHERE rowid = ${rowid}`,
      );
      await session.checkpoint();
      pushUndo({ kind: "cell", table: meta.name, rowid, column, previous });
      setGrid((current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((row) =>
            Number(row._rowid) === rowid ? { ...row, [column]: storedValue(text, type) } : row,
          ),
        };
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not update that cell.");
    }
  }

  async function deleteRow(rowid: number) {
    if (!meta) return;
    const source = grid?.rows.find((row) => Number(row._rowid) === rowid);
    const values: Record<string, string> = {};
    if (source) {
      for (const column of meta.columns) values[column.name] = cellText(source[column.name]);
    }
    const session = await getSession();
    await session.query(`DELETE FROM ${qid(meta.name)} WHERE rowid = ${rowid}`);
    await session.checkpoint();
    if (source) pushUndo({ kind: "delete", table: meta.name, values });
    setOpenRow(null);
    await refreshTables(table);
  }

  async function addRow() {
    if (!meta) return;
    const cols = meta.columns.map((column) => qid(column.name)).join(", ");
    const values = meta.columns.map(() => "NULL").join(", ");
    const session = await getSession();
    const inserted = await session.query(
      `INSERT INTO ${qid(meta.name)} (${cols}) VALUES (${values}) RETURNING rowid`,
    );
    await session.checkpoint();
    const rowid = Number(inserted.rows[0]?.rowid);
    if (Number.isFinite(rowid)) pushUndo({ kind: "insert", table: meta.name, rowid });
    setPage(0);
    await refreshTables(table);
  }

  async function undoLast() {
    const entry = undoRef.current[undoRef.current.length - 1];
    if (!entry) return;
    undoRef.current = undoRef.current.slice(0, -1);
    setUndoCount(undoRef.current.length);
    const owner = tables.find((item) => item.name === entry.table);
    const session = await getSession();
    try {
      if (entry.kind === "cell") {
        const type = owner?.columns.find((column) => column.name === entry.column)?.type ?? "";
        await session.query(
          `UPDATE ${qid(entry.table)} SET ${qid(entry.column)} = ${valueSql(entry.previous, type)} WHERE rowid = ${entry.rowid}`,
        );
      } else if (entry.kind === "insert") {
        await session.query(`DELETE FROM ${qid(entry.table)} WHERE rowid = ${entry.rowid}`);
      } else if (owner) {
        const names = owner.columns.map((column) => qid(column.name)).join(", ");
        const values = owner.columns
          .map((column) => valueSql(entry.values[column.name] ?? "", column.type))
          .join(", ");
        await session.query(`INSERT INTO ${qid(entry.table)} (${names}) VALUES (${values})`);
      }
      await session.checkpoint();
      if (entry.table === table) await refreshTables(table);
      setNotice("Undid the last edit.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not undo that edit.");
    }
  }

  useEffect(() => {
    if (!allowEdit || !editing) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (undoRef.current.length === 0) return;
      event.preventDefault();
      void undoLast();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function createTable() {
    const defs = newColumns
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const columns = (defs.length ? defs : ["note VARCHAR"]).map((line) => {
      const [rawName, rawType] = line.split(/\s+/, 2);
      const type = (rawType ?? "VARCHAR").toUpperCase();
      if (!/^(VARCHAR|INTEGER|BIGINT|DOUBLE|BOOLEAN|DATE|TIMESTAMP|BLOB)$/.test(type)) {
        throw new Error(`Use VARCHAR, INTEGER, DOUBLE, BOOLEAN, DATE, TIMESTAMP, or BLOB — not ${rawType ?? ""}`.trim());
      }
      return `${qid(safeName(rawName))} ${type}`;
    });
    const name = safeName(newTable);
    const session = await getSession();
    await session.query(`CREATE TABLE ${qid(name)} (${columns.join(", ")})`);
    await session.checkpoint();
    await refreshTables(name);
    setEditing(true);
    setNotice(`Created ${name}.`);
  }

  async function saveNotes() {
    if (!meta) return;
    const session = await getSession();
    await session.query(
      `CREATE TABLE IF NOT EXISTS _desk_notes (
         table_name VARCHAR PRIMARY KEY,
         about VARCHAR,
         source VARCHAR,
         license VARCHAR
       )`,
    );
    await session.query(`DELETE FROM _desk_notes WHERE table_name = ${lit(meta.name)}`);
    await session.query(
      `INSERT INTO _desk_notes VALUES (${lit(meta.name)}, ${lit(notes.about)}, ${lit(notes.source)}, ${lit(notes.license)})`,
    );
    await session.checkpoint();
    setNotice(`Saved notes for ${meta.name}.`);
  }

  function writeTemplate(kind: "insert" | "update" | "delete" | "create") {
    if (kind === "create") {
      setSql(`CREATE TABLE ${qid(safeName(newTable || "notes"))} (\n  title VARCHAR,\n  body VARCHAR\n)`);
    } else if (meta && kind === "insert") {
      const cols = meta.columns.map((column) => qid(column.name)).join(", ");
      const vals = meta.columns.map((column) => `:${column.name}`).join(", ");
      setSql(`INSERT INTO ${qid(meta.name)} (${cols})\nVALUES (${vals})`);
    } else if (meta && kind === "update") {
      const sets = meta.columns.map((column) => `${qid(column.name)} = :${column.name}`).join(",\n  ");
      setSql(`UPDATE ${qid(meta.name)} SET\n  ${sets}\nWHERE rowid = :rowid`);
    } else if (meta) {
      setSql(`DELETE FROM ${qid(meta.name)} WHERE rowid = :rowid`);
    }
    setView("query");
  }

  async function exportRows(kind: "csv" | "json") {
    const session = await getSession();
    let result: QueryResult | null = view === "query" ? sqlResult : null;
    if (view !== "query" && meta) {
      const where = whereClause(meta, search, filters, rules);
      const order = sort ? ` ORDER BY ${qid(sort.column)} ${sort.dir} NULLS LAST` : "";
      result = await session.query(
        `SELECT * FROM ${qid(meta.name)}${where}${order} LIMIT ${EXPORT_CAP + 1}`,
      );
      if (result.rows.length > EXPORT_CAP) {
        result = { ...result, rows: result.rows.slice(0, EXPORT_CAP) };
        setNotice(`Export stopped at ${EXPORT_CAP.toLocaleString()} rows.`);
      }
    }
    if (!result?.rows.length) return;
    const stem = view === "query" ? "query" : table;
    if (kind === "json") {
      const records = result.rows.map((row) => {
        const record: Record<string, unknown> = {};
        for (const column of result.columns) record[column] = row[column] ?? null;
        return record;
      });
      download(
        `${stem}.json`,
        new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }),
      );
      return;
    }
    const lines = [
      result.columns.join(","),
      ...result.rows.map((row) =>
        result.columns
          .map((column) => `"${cellText(row[column]).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    download(`${stem}.csv`, new Blob([lines.join("\n")], { type: "text/csv" }));
  }

  async function downloadDatabase() {
    setBusy(true);
    setNotice("Packing the database…");
    try {
      const session = await getSession();
      const bytes = await session.exportBytes();
      const name = currentDatabase().name.replace(/[^\w.-]+/g, "_") || "carrel";
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      download(`${name}.duckdb`, new Blob([copy], { type: "application/octet-stream" }));
      setNotice(`Downloaded ${name}.duckdb. Open it in another Carrel.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not download that database.");
    } finally {
      setBusy(false);
    }
  }

  async function ingest(file: File) {
    setNotice(`Reading ${file.name}…`);
    setBusy(true);
    try {
      const session = await getSession();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "duckdb" || isDuckDb(bytes)) {
        setPhase("boot");
        const created = await adoptDatabase(fileTitle(file.name), bytes);
        setActiveDb(created.id);
        setDatabases(listDatabases());
        await refreshTables();
        await loadSaved();
        await loadHistory();
        setNotice(`Opened ${created.name}.`);
        setPhase("ready");
        setView("browse");
        return;
      }
      if (ext === "db" || ext === "sqlite" || ext === "sqlite3") {
        const created = await importSqlite(bytes, (sql) => session.query(sql), new Set(tables.map((item) => item.name)));
        await session.checkpoint();
        await refreshTables(created[0]);
        setView("browse");
        const listed = created.length > 4 ? `${created.slice(0, 4).join(", ")} +${created.length - 4}` : created.join(", ");
        setNotice(`Loaded ${file.name} as ${listed}.`);
        return;
      }
      const fileName = `upload_${Date.now()}_${safeName(file.name)}.${ext || "dat"}`;
      await session.register(fileName, bytes);
      let base = safeName(file.name);
      const taken = new Set(tables.map((item) => item.name));
      while (taken.has(base)) base = `${base}_2`;
      const reader =
        ext === "parquet" || ext === "pq"
          ? `read_parquet(${lit(fileName)})`
          : ext === "json"
            ? `read_json_auto(${lit(fileName)})`
            : `read_csv_auto(${lit(fileName)}, header=true)`;
      await session.query(`CREATE TABLE ${qid(base)} AS SELECT * FROM ${reader}`);
      await session.checkpoint();
      await refreshTables(base);
      setView("browse");
      setNotice(`Loaded ${file.name} as ${base}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not read that file.");
      setPhase((current) => (current === "boot" ? "ready" : current));
    } finally {
      setBusy(false);
    }
  }

  function download(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (phase === "boot") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-serif text-3xl text-ink">Carrel</p>
        <p className="max-w-sm text-muted">Starting the analytical engine in this tab.</p>
        <div className="plaque-meter">
          <div className="h-full w-1/2 animate-pulse bg-stamp" />
        </div>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-serif text-3xl text-ink">Engine did not start</p>
        <p className="max-w-md text-muted">{error}</p>
        <button
          className="plaque plaque-ink min-h-11 px-4 py-3 text-sm"
          onClick={() => {
            resetSession().then(() =>
              getSession()
                .then(() => refreshTables("cities"))
                .then(() => setPhase("ready"))
                .catch((err: unknown) => {
                  resetSession();
                  setError(err instanceof Error ? err.message : "Still unavailable.");
                  setPhase("error");
                }),
            );
          }}
        >
          Try again
        </button>
      </main>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div
      className="min-h-screen"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void ingest(file);
      }}
    >
      <header className="shrink-0 border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="plaque-mark grid size-10 place-items-center bg-ink font-serif text-lg text-paper">
              C
            </span>
            <div>
              <h1 className="font-serif text-2xl leading-none">Carrel</h1>
              <p className="text-sm text-muted">Saved in this browser. Nothing is uploaded.</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
              Database
              <select
                value={activeDb}
                onChange={(event) => void restartOn(event.target.value)}
                className="plaque-field min-h-11 bg-paper px-3"
              >
                {databases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="plaque plaque-stamp inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium">
              <Upload className="size-4" />
              Open file
              <input
                className="sr-only"
                type="file"
                accept=".csv,.tsv,.json,.parquet,.pq,.db,.sqlite,.sqlite3,.duckdb"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void ingest(file);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => void downloadDatabase()}
              className="plaque inline-flex min-h-11 items-center gap-2 px-4 text-sm"
            >
              <Download className="size-4" />
              Download
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex gap-2 overflow-x-auto py-1">
          {tables.map((item) => (
            <button
              key={item.name}
              onClick={() => setTable(item.name)}
              className={
                "plaque inline-flex min-h-11 shrink-0 items-center gap-2 px-4 text-sm " +
                (item.name === table ? "plaque-ink" : "")
              }
            >
              <Database className="size-4" />
              {item.name}
              <span className="tabular-nums opacity-70">{item.rows.toLocaleString()}</span>
            </button>
          ))}
        </div>

        <div className="plaque-tray">
          {(
            [
              ["browse", "Browse", Table2],
              ["query", "SQL", Play],
              ["chart", "Chart", BarChart3],
              ["map", "Map", MapIcon],
              ["settings", "Settings", Settings],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={
                "plaque-seg inline-flex min-h-11 items-center gap-2 px-4 text-sm " +
                (view === id ? "plaque-seg-on" : "")
              }
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {notice ? <p className="text-sm text-muted">{notice}</p> : null}
        {dragOver ? (
          <p className="rounded-card border border-dashed border-stamp bg-stamp-soft px-4 py-6 text-center text-stamp">
            Drop a CSV, JSON, Parquet, or SQLite file
          </p>
        ) : null}

        {view === "browse" && !meta && (
          <section className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-6">
            <p className="text-muted">This database has no tables yet.</p>
            {allowEdit ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-muted">
                New table
                <input
                  value={newTable}
                  onChange={(event) => setNewTable(event.target.value)}
                  className="plaque-field min-h-11 px-3 text-ink"
                />
              </label>
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-muted">
                Columns, one per line
                <textarea
                  value={newColumns}
                  onChange={(event) => setNewColumns(event.target.value)}
                  className="plaque-field min-h-20 px-3 py-2 font-mono text-sm text-ink"
                />
              </label>
              <button
                onClick={() =>
                  void createTable().catch((err: unknown) =>
                    setNotice(err instanceof Error ? err.message : "Could not create that table."),
                  )
                }
                className="plaque plaque-ink min-h-11 px-4 text-sm"
              >
                Create table
              </button>
            </div>
            ) : (
              <p className="text-sm text-muted">Allow editing in Settings to create a table.</p>
            )}
          </section>
        )}

        {view === "browse" && meta && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search rows"
                className="plaque-field min-h-11 min-w-48 flex-1 px-4 text-sm"
              />
              <p className="text-sm text-muted tabular-nums">
                {total.toLocaleString()} row{total === 1 ? "" : "s"}
                {busy ? " · working" : ""}
              </p>
              {allowEdit ? (
                <button
                  onClick={() => setEditing((value) => !value)}
                  className={"plaque min-h-11 px-4 text-sm " + (editing ? "plaque-stamp" : "")}
                >
                  {editing ? "Editing" : "Edit"}
                </button>
              ) : null}
              {allowEdit && editing ? (
                <p className="text-sm text-muted">Click a cell. Type, or press Enter. Ctrl+Z undoes.</p>
              ) : null}
              {allowEdit && editing ? (
                <button
                  onClick={() => void undoLast()}
                  disabled={undoCount === 0}
                  className="plaque min-h-11 px-4 text-sm"
                >
                  Undo
                </button>
              ) : null}
              {allowEdit && editing ? (
                <button onClick={() => void addRow()} className="plaque min-h-11 px-4 text-sm">
                  Add row
                </button>
              ) : null}
              <button
                onClick={() => void exportRows("csv")}
                className="plaque inline-flex min-h-11 items-center gap-2 px-4 text-sm"
              >
                <Download className="size-4" />
                CSV
              </button>
              <button
                onClick={() => void exportRows("json")}
                className="plaque inline-flex min-h-11 items-center gap-2 px-4 text-sm"
              >
                JSON
              </button>
              <button onClick={() => void copyPage()} className="plaque min-h-11 px-4 text-sm">
                Copy
              </button>
              <button
                onClick={() => setShape((value) => (value === "json" ? "grid" : "json"))}
                className={"plaque min-h-11 px-4 text-sm " + (shape === "json" ? "plaque-stamp" : "")}
              >
                {shape === "json" ? "Grid" : "As JSON"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterBar
                columns={meta.columns}
                op={ruleOp}
                value={ruleValue}
                onOp={setRuleOp}
                onValue={setRuleValue}
                onAdd={(column) => {
                  if (!column) return;
                  if (ruleOp !== "empty" && ruleOp !== "notempty" && !ruleValue.trim()) return;
                  setPage(0);
                  setRules((current) => [
                    ...current,
                    { id: Date.now(), column, op: ruleOp, value: ruleValue.trim() },
                  ]);
                  setRuleValue("");
                }}
              />
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => {
                    setPage(0);
                    setRules((current) => current.filter((item) => item.id !== rule.id));
                  }}
                  className="plaque plaque-stamp min-h-11 px-3 text-sm"
                >
                  {rule.column} {ruleLabel(rule.op)} {rule.op === "empty" || rule.op === "notempty" ? "" : rule.value} ×
                </button>
              ))}
            </div>
            <details className="rounded-card border border-line bg-card px-4 py-3 text-sm">
              <summary className="cursor-pointer text-muted">About this table</summary>
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={notes.about}
                  onChange={(event) => setNotes((current) => ({ ...current, about: event.target.value }))}
                  placeholder="What this table is"
                  className="plaque-field min-h-11 px-3"
                />
                <input
                  value={notes.source}
                  onChange={(event) => setNotes((current) => ({ ...current, source: event.target.value }))}
                  placeholder="Source"
                  className="plaque-field min-h-11 px-3"
                />
                <input
                  value={notes.license}
                  onChange={(event) => setNotes((current) => ({ ...current, license: event.target.value }))}
                  placeholder="License"
                  className="plaque-field min-h-11 px-3"
                />
                <button onClick={() => void saveNotes()} className="plaque min-h-11 self-start px-4 text-sm">
                  Save notes
                </button>
              </div>
            </details>
            {allowEdit && editing ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm text-muted">
                  New table
                  <input
                    value={newTable}
                    onChange={(event) => setNewTable(event.target.value)}
                    className="plaque-field min-h-11 px-3 text-ink"
                  />
                </label>
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-muted">
                  Columns, one per line
                  <textarea
                    value={newColumns}
                    onChange={(event) => setNewColumns(event.target.value)}
                    className="plaque-field min-h-20 px-3 py-2 font-mono text-sm text-ink"
                  />
                </label>
                <button
                  onClick={() =>
                    void createTable().catch((err: unknown) =>
                      setNotice(err instanceof Error ? err.message : "Could not create that table."),
                    )
                  }
                  className="plaque plaque-ink min-h-11 px-4 text-sm"
                >
                  Create table
                </button>
                <button
                  onClick={() =>
                    void dropTable().catch((err: unknown) =>
                      setNotice(err instanceof Error ? err.message : "Could not drop that table."),
                    )
                  }
                  className="plaque min-h-11 px-4 text-sm"
                >
                  {confirmDrop ? `Drop ${meta.name}` : "Drop table"}
                </button>
              </div>
            ) : null}
            {Object.entries(facets).map(([column, values]) => (
              <div key={column} className="flex flex-wrap items-center gap-2">
                <span className="text-xs tracking-wide text-muted uppercase">{column}</span>
                {values.map((facet) => {
                  const active = filters[column] === facet.value;
                  const label = facet.value ?? "empty";
                  return (
                    <button
                      key={label}
                      onClick={() => {
                        setPage(0);
                        setFilters((current) => {
                          const next = { ...current };
                          if (active) delete next[column];
                          else next[column] = facet.value;
                          return next;
                        });
                      }}
                      className={
                        "plaque min-h-11 px-3 text-sm " +
                        (active ? "plaque-stamp" : "")
                      }
                    >
                      {label} <span className="tabular-nums opacity-70">{facet.n}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {profile && profile.column === inspect ? (
              <div className="rounded-card border border-line bg-card px-4 py-3 text-sm">
                <p className="font-medium">
                  {profile.column}{" "}
                  <span className="font-normal text-muted">{profile.type}</span>
                </p>
                <p className="mt-1 text-muted tabular-nums">
                  {profile.n.toLocaleString()} values · {profile.empty.toLocaleString()} empty ·{" "}
                  {profile.distinct.toLocaleString()} distinct
                </p>
                <p className="text-muted">
                  min {profile.min || "—"} · max {profile.max || "—"}
                </p>
                <p className="mt-1 text-muted">
                  {profile.top.map((item) => `${item.value} ${item.n.toLocaleString()}`).join(" · ")}
                </p>
              </div>
            ) : null}
            <div className="order-first min-h-[50vh] overflow-auto">
            {notes.about || notes.source || notes.license ? (
              <p className="mb-2 text-sm text-muted">
                {[notes.about, notes.source, notes.license].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {!grid ? (
              <p className="px-4 py-8 text-center text-muted">
                {busy ? "Opening this table…" : "This table has nothing to show yet."}
              </p>
            ) : null}
            {shape === "json" && grid ? (
              <pre className="overflow-auto rounded-card border border-line bg-card p-4 text-xs leading-relaxed">
                {JSON.stringify(
                  grid.rows.map((row) => {
                    const record: Record<string, unknown> = {};
                    for (const column of grid.columns) {
                      if (column === "_rowid") continue;
                      record[column] = row[column] ?? null;
                    }
                    return record;
                  }),
                  null,
                  2,
                )}
              </pre>
            ) : (
            <ResultTable
              result={grid}
              types={Object.fromEntries(meta.columns.map((column) => [column.name, column.type]))}
              editing={allowEdit && editing}
              onCommit={(rowid, column, text) => void commitCell(rowid, column, text)}
              onDelete={(rowid) => void deleteRow(rowid)}
              onOpen={editing ? undefined : setOpenRow}
              onSort={(column) => {
                setPage(0);
                setInspect(column);
                setSort((current) =>
                  current?.column === column
                    ? { column, dir: current.dir === "ASC" ? "DESC" : "ASC" }
                    : { column, dir: "ASC" },
                );
              }}
            />
            )}
            </div>
            {openRow ? (
              <div className="rounded-card border border-line bg-card px-4 py-3 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium">Row</p>
                  <button onClick={() => setOpenRow(null)} className="plaque plaque-quiet min-h-11 px-3 text-sm">
                    Close
                  </button>
                </div>
                <dl className="grid gap-2">
                  {Object.entries(openRow)
                    .filter(([key]) => key !== "_rowid")
                    .map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[8rem_1fr] gap-3">
                        <dt className="text-muted">{key}</dt>
                        <dd>
                          <Cell value={value} />
                          {fks
                            .filter((fk) => fk.column === key && value != null && value !== "")
                            .map((fk) => (
                              <button
                                key={fk.table}
                                onClick={() => {
                                  setSearch(cellText(value));
                                  setTable(fk.table);
                                  setOpenRow(null);
                                }}
                                className="ml-2 text-stamp underline"
                              >
                                in {fk.table}
                              </button>
                            ))}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <button
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                className="plaque plaque-quiet inline-flex min-h-11 items-center gap-1 px-3 text-sm"
              >
                <ChevronLeft className="size-4" /> Previous
              </button>
              <p className="text-sm text-muted tabular-nums">
                {page + 1} / {pages}
              </p>
              <button
                disabled={page + 1 >= pages}
                onClick={() => setPage((value) => value + 1)}
                className="plaque plaque-quiet inline-flex min-h-11 items-center gap-1 px-3 text-sm"
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          </section>
        )}

        {view === "query" && (
          <section className="flex flex-col gap-3">
            <div className="flex gap-2 overflow-x-auto py-1">
              {CANNED.filter((item) =>
                [...item.sql.matchAll(/\bFROM\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].every((match) =>
                  tables.some((tableItem) => tableItem.name === match[1]),
                ),
              ).map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setSql(item.sql);
                    void runSql(item.sql);
                  }}
                  className="plaque min-h-11 shrink-0 px-4 text-sm"
                >
                  {item.label}
                </button>
              ))}
              {saved.map((item) => (
                <span key={item.name} className="plaque inline-flex min-h-11 shrink-0 items-stretch">
                  <button
                    onClick={() => {
                      setSql(item.sql);
                      setQueryName(item.name);
                      void runSql(item.sql);
                    }}
                    className="px-4 text-sm"
                  >
                    {item.name}
                  </button>
                  <button
                    aria-label={`Remove ${item.name}`}
                    onClick={() => void forgetQuery(item.name)}
                    className="border-l border-line px-3 text-sm text-muted"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {allowEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSqlWriting((value) => !value)}
                  className={"plaque min-h-11 px-4 text-sm " + (sqlWriting ? "plaque-stamp" : "")}
                >
                  {sqlWriting ? "Writes on" : "Writes"}
                </button>
                {sqlWriting ? (
                  <>
                    <button onClick={() => writeTemplate("insert")} className="plaque min-h-11 px-4 text-sm">
                      Insert
                    </button>
                    <button onClick={() => writeTemplate("update")} className="plaque min-h-11 px-4 text-sm">
                      Update
                    </button>
                    <button onClick={() => writeTemplate("delete")} className="plaque min-h-11 px-4 text-sm">
                      Delete
                    </button>
                    <button onClick={() => writeTemplate("create")} className="plaque min-h-11 px-4 text-sm">
                      Create table
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            {paramNames.length ? (
              <div className="flex flex-wrap gap-2">
                {paramNames.map((name) => (
                  <label key={name} className="flex min-h-11 items-center gap-2 text-sm text-muted">
                    :{name}
                    <input
                      value={params[name] ?? ""}
                      onChange={(event) =>
                        setParams((current) => ({ ...current, [name]: event.target.value }))
                      }
                      className="plaque-field min-h-11 w-36 px-3 text-ink"
                    />
                  </label>
                ))}
              </div>
            ) : null}
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void runSql();
                }
              }}
              spellCheck={false}
              className="min-h-40 w-full rounded-card border border-line bg-card p-4 font-mono text-sm leading-relaxed outline-none"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void runSql()}
                className="plaque plaque-ink inline-flex min-h-11 items-center gap-2 px-4 text-sm"
              >
                <Play className="size-4" />
                Run
              </button>
              <input
                value={queryName}
                onChange={(event) => setQueryName(event.target.value)}
                placeholder="Name this query"
                className="plaque-field min-h-11 w-44 px-4 text-sm"
              />
              <button
                onClick={() => void saveQuery()}
                className="plaque inline-flex min-h-11 items-center px-4 text-sm"
              >
                Save
              </button>
              <button
                onClick={() => void exportRows("csv")}
                className="plaque inline-flex min-h-11 items-center gap-2 px-4 text-sm"
              >
                <Download className="size-4" />
                CSV
              </button>
              <button
                onClick={() => void exportRows("json")}
                className="plaque inline-flex min-h-11 items-center px-4 text-sm"
              >
                JSON
              </button>
              <button onClick={() => void copyPage()} className="plaque min-h-11 px-4 text-sm">
                Copy
              </button>
              {sqlResult ? (
                <p className="text-sm text-muted tabular-nums">
                  {sqlResult.rows.length.toLocaleString()} rows · {sqlResult.ms} ms
                </p>
              ) : null}
            </div>
            {sqlError ? <p className="text-sm text-stamp">{sqlError}</p> : null}
            {history.length ? (
              <div className="flex gap-2 overflow-x-auto py-1">
                {history.map((item) => (
                  <button
                    key={item.at}
                    onClick={() => setSql(item.sql)}
                    title={item.sql}
                    className="plaque min-h-11 max-w-56 shrink-0 truncate px-4 text-sm"
                  >
                    {item.ok ? "" : "Failed · "}
                    {item.sql.replace(/\s+/g, " ").slice(0, 48)}
                  </button>
                ))}
              </div>
            ) : null}
            <ResultTable result={sqlResult} />
          </section>
        )}

        {view === "settings" && (
          <section className="flex max-w-2xl flex-col gap-4">
            <div className="rounded-card border border-line bg-card px-4 py-4">
              <h2 className="font-serif text-xl">Editing</h2>
              <p className="mt-1 text-sm text-muted">
                Off until you allow it. Browse and SQL then show their own switches.
              </p>
              <button
                onClick={() => {
                  const next = !allowEdit;
                  setAllowEdit(next);
                  localStorage.setItem("carrel.allowEdit", next ? "1" : "0");
                  if (!next) {
                    setEditing(false);
                    setSqlWriting(false);
                  }
                }}
                className={"plaque mt-3 min-h-11 px-4 text-sm " + (allowEdit ? "plaque-stamp" : "")}
              >
                {allowEdit ? "Editing allowed" : "Editing off"}
              </button>
            </div>
            <div className="rounded-card border border-line bg-card px-4 py-4">
              <h2 className="font-serif text-xl">Databases</h2>
              <p className="mt-1 text-sm text-muted">
                The shipped desks are already here. A new one starts empty.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {databases.map((item) => {
                  const sample = SAMPLE_DATABASES.find((sampleItem) => sampleItem.id === item.id);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-2">
                      {renameId === item.id ? (
                        <>
                          <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            className="plaque-field min-h-11 w-44 px-3 text-sm"
                          />
                          <button onClick={() => renameDesk(item.id)} className="plaque plaque-ink min-h-11 px-4 text-sm">
                            Save
                          </button>
                          <button onClick={() => setRenameId(null)} className="plaque min-h-11 px-4 text-sm">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => void restartOn(item.id)}
                            className={
                              "plaque min-h-11 px-4 text-sm " + (item.id === activeDb ? "plaque-ink" : "")
                            }
                          >
                            {item.name}
                          </button>
                          <button
                            onClick={() => {
                              setRenameId(item.id);
                              setRenameValue(item.name);
                              setConfirmRemove(null);
                            }}
                            className="plaque min-h-11 px-4 text-sm"
                          >
                            Rename
                          </button>
                          {databases.length > 1 ? (
                            <button
                              onClick={() => void removeDesk(item.id)}
                              className="plaque min-h-11 px-4 text-sm"
                            >
                              {confirmRemove === item.id ? "Remove it" : "Remove"}
                            </button>
                          ) : null}
                        </>
                      )}
                      <span className="text-sm text-muted">{sample?.about ?? "Created in this browser."}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  value={dbName}
                  onChange={(event) => setDbName(event.target.value)}
                  placeholder="New database name"
                  className="plaque-field min-h-11 w-56 px-3 text-sm"
                />
                <button onClick={() => void makeDatabase()} className="plaque plaque-ink min-h-11 px-4 text-sm">
                  Create database
                </button>
              </div>
            </div>
          </section>
        )}

        {view === "chart" && meta && (
          <section className="flex flex-col gap-4 rounded-card border border-line bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <Select label="X" value={chartX} onChange={setChartX} columns={meta.columns} />
              <Select label="Y" value={chartY} onChange={setChartY} columns={meta.columns} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
                Shape
                <select
                  value={chartKind}
                  onChange={(event) => setChartKind(event.target.value as ChartKind)}
                  className="plaque-field min-h-11 bg-paper px-3"
                >
                  <option value="bar">Bars</option>
                  <option value="line">Line</option>
                </select>
              </label>
            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartKind === "line" ? (
                  <LineChart data={chartRows}>
                    <CartesianGrid stroke="#e3d9c8" vertical={false} />
                    <XAxis dataKey="x" stroke="#6e655c" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#6e655c" tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="y" stroke="#b45309" strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <BarChart data={chartRows}>
                    <CartesianGrid stroke="#e3d9c8" vertical={false} />
                    <XAxis dataKey="x" stroke="#6e655c" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#6e655c" tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="y" fill="#b45309" radius={4} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {view === "map" && (
          <section className="overflow-hidden rounded-card border border-line bg-card p-2">
            {!geo ? (
              <p className="px-4 py-10 text-center text-muted">
                This table has no latitude and longitude columns.
              </p>
            ) : MapPane ? (
              <MapPane points={mapPoints} />
            ) : (
              <p className="px-4 py-10 text-center text-muted">Opening the map…</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  columns,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  columns: Column[];
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="plaque-field min-h-11 bg-paper px-3"
      >
        {columns.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultTable({
  result,
  onSort,
  editing,
  onCommit,
  onDelete,
  onOpen,
  types,
}: {
  result: QueryResult | null;
  onSort?: (column: string) => void;
  editing?: boolean;
  onCommit?: (rowid: number, column: string, text: string) => void;
  onDelete?: (rowid: number) => void;
  onOpen?: (row: Record<string, unknown>) => void;
  types?: Record<string, string>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  const skipCommit = useRef(false);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState(false);
  const [draft, setDraft] = useState("");
  const columns = result?.columns.filter((column) => column !== "_rowid") ?? [];

  useEffect(() => {
    if (!editing) {
      setActive(null);
      setEditingCell(false);
    }
  }, [editing]);

  if (!result || !columns.length) return null;

  function beginEdit(text: string) {
    draftRef.current = text;
    setDraft(text);
    setEditingCell(true);
  }

  function commitDraft() {
    if (!active || !onCommit || !result) return;
    const row = result.rows[active.row];
    const column = columns[active.col];
    if (!row || row._rowid == null || !column) return;
    if (draftRef.current !== cellText(row[column])) onCommit(Number(row._rowid), column, draftRef.current);
  }

  function move(row: number, col: number) {
    if (!result) return;
    setActive({
      row: Math.max(0, Math.min(result.rows.length - 1, row)),
      col: Math.max(0, Math.min(columns.length - 1, col)),
    });
    setEditingCell(false);
    gridRef.current?.focus();
  }

  function onGridKey(event: KeyboardEvent) {
    if (!editing || editingCell || !result) return;
    const row = active?.row ?? 0;
    const col = active?.col ?? 0;
    if (!active && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) {
      event.preventDefault();
      setActive({ row: 0, col: 0 });
      return;
    }
    if (!active) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(row + 1, col);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(row - 1, col);
    } else if (event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      move(col + 1 >= columns.length ? Math.min(result.rows.length - 1, row + 1) : row, (col + 1) % columns.length);
    } else if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      move(col - 1 < 0 ? Math.max(0, row - 1) : row, col - 1 < 0 ? columns.length - 1 : col - 1);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdit(cellText(result.rows[row]?.[columns[col]]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const current = result.rows[row];
      const column = columns[col];
      if (current?._rowid != null && column && onCommit) onCommit(Number(current._rowid), column, "");
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      beginEdit(event.key);
    }
  }

  return (
    <div
      ref={gridRef}
      tabIndex={editing ? 0 : undefined}
      onKeyDown={onGridKey}
      className="sheet-grid overflow-x-auto rounded-card border border-line bg-card"
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-muted">
            {editing ? <th className="sheet-gutter px-2 py-2 font-normal" /> : null}
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-medium">
                {onSort ? (
                  <button className="plaque-text min-h-11 text-left" onClick={() => onSort(column)}>
                    <span className="block">{column}</span>
                    {types?.[column] ? (
                      <span className="block text-xs font-normal">{types[column]}</span>
                    ) : null}
                  </button>
                ) : (
                  column
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr
              key={row._rowid == null ? index : String(row._rowid)}
              onClick={() => onOpen?.(row)}
              className={"border-b border-line last:border-0 " + (onOpen ? "cursor-pointer" : "")}
            >
              {editing && onDelete && row._rowid != null ? (
                <td className="sheet-gutter px-2 py-2">
                  {active?.row === index ? (
                    <button
                      aria-label="Delete row"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(Number(row._rowid));
                      }}
                      className="sheet-row-x"
                    >
                      ×
                    </button>
                  ) : (
                    index + 1
                  )}
                </td>
              ) : null}
              {columns.map((column, colIndex) => {
                const isActive = editing && active?.row === index && active.col === colIndex;
                const isEditing = isActive && editingCell && row._rowid != null;
                return (
                  <td
                    key={column}
                    className={"max-w-xs px-3 py-2 align-middle tabular-nums " + (isActive ? "sheet-on" : "")}
                    onClick={(event) => {
                      if (!editing) return;
                      event.stopPropagation();
                      setActive({ row: index, col: colIndex });
                      setEditingCell(false);
                      gridRef.current?.focus();
                    }}
                    onDoubleClick={(event) => {
                      if (!editing || row._rowid == null) return;
                      event.stopPropagation();
                      setActive({ row: index, col: colIndex });
                      beginEdit(cellText(row[column]));
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draft}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          draftRef.current = event.target.value;
                          setDraft(event.target.value);
                        }}
                        onBlur={() => {
                          if (skipCommit.current) {
                            skipCommit.current = false;
                            return;
                          }
                          commitDraft();
                          setEditingCell(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitDraft();
                            move(index + 1, colIndex);
                          } else if (event.key === "Tab") {
                            event.preventDefault();
                            commitDraft();
                            const forward = !event.shiftKey;
                            move(
                              forward
                                ? colIndex + 1 >= columns.length
                                  ? index + 1
                                  : index
                                : colIndex === 0
                                  ? index - 1
                                  : index,
                              forward
                                ? (colIndex + 1) % columns.length
                                : colIndex === 0
                                  ? columns.length - 1
                                  : colIndex - 1,
                            );
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            skipCommit.current = true;
                            setEditingCell(false);
                            gridRef.current?.focus();
                          }
                        }}
                        className="sheet-input"
                      />
                    ) : (
                      <Cell value={row[column]} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 ? <p className="px-4 py-8 text-center text-muted">No rows.</p> : null}
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value == null || value === "") return <span className="text-muted">—</span>;
  if (typeof value === "number") return <span>{value.toLocaleString()}</span>;
  const text = cellText(value);
  if (isImageUrl(text)) {
    return <img src={text} alt="" className="max-h-24 rounded" />;
  }
  if (isHttpUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="text-stamp underline">
        {text}
      </a>
    );
  }
  if (looksLikeMarkdown(text)) return <RichText text={text} />;
  if (looksLikeJson(text)) {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      pretty = text;
    }
    return (
      <details>
        <summary className="cursor-pointer text-stamp">JSON</summary>
        <pre className="mt-2 max-h-40 overflow-auto text-xs whitespace-pre-wrap">{pretty}</pre>
      </details>
    );
  }
  return <span>{text}</span>;
}

function isImageUrl(text: string): boolean {
  return /^https:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(text) || text.startsWith("data:image/");
}

function isHttpUrl(text: string): boolean {
  return /^https:\/\/\S+$/i.test(text);
}

function looksLikeMarkdown(text: string): boolean {
  return /\*\*[^*]+\*\*/.test(text) || /(^|\n)#{1,3} /.test(text) || /\[[^\]]+\]\(https:\/\//.test(text);
}

function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, index) => (
        <p key={index}>{inlineMarks(line.replace(/^#{1,3}\s+/, ""))}</p>
      ))}
    </div>
  );
}

function inlineMarks(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    if (match[1]) nodes.push(<strong key={match.index}>{match[1]}</strong>);
    else {
      nodes.push(
        <a key={match.index} href={match[3]} target="_blank" rel="noreferrer" className="text-stamp underline">
          {match[2]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

function whereClause(
  meta: TableMeta,
  search: string,
  filters: Record<string, string | null>,
  rules: Rule[] = [],
): string {
  const parts: string[] = [];
  const needle = search.trim();
  if (needle) {
    const texts = meta.columns.filter((column) => !isNumericType(column.type));
    const cols = (texts.length ? texts : meta.columns).map((column) => `cast(${qid(column.name)} AS VARCHAR)`);
    parts.push(`concat_ws(' ', ${cols.join(", ")}) ILIKE ${lit(`%${needle}%`)}`);
  }
  for (const [column, value] of Object.entries(filters)) {
    parts.push(value == null ? `${qid(column)} IS NULL` : `${qid(column)} = ${lit(value)}`);
  }
  for (const rule of rules) {
    const column = qid(rule.column);
    if (rule.op === "empty") parts.push(`(${column} IS NULL OR cast(${column} AS VARCHAR) = '')`);
    else if (rule.op === "notempty") parts.push(`(${column} IS NOT NULL AND cast(${column} AS VARCHAR) <> '')`);
    else if (rule.op === "contains") parts.push(`cast(${column} AS VARCHAR) ILIKE ${lit(`%${rule.value}%`)}`);
    else if (rule.op === "gt") parts.push(`${column} > ${valueSql(rule.value)}`);
    else if (rule.op === "lt") parts.push(`${column} < ${valueSql(rule.value)}`);
    else parts.push(`${column} = ${valueSql(rule.value)}`);
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function FilterBar({
  columns,
  op,
  value,
  onOp,
  onValue,
  onAdd,
}: {
  columns: Column[];
  op: RuleOp;
  value: string;
  onOp: (op: RuleOp) => void;
  onValue: (value: string) => void;
  onAdd: (column: string) => void;
}) {
  const [column, setColumn] = useState(columns[0]?.name ?? "");
  useEffect(() => {
    if (!columns.some((item) => item.name === column)) setColumn(columns[0]?.name ?? "");
  }, [columns, column]);
  return (
    <>
      <select
        value={column}
        onChange={(event) => setColumn(event.target.value)}
        className="plaque-field min-h-11 bg-paper px-3 text-sm"
      >
        {columns.map((item) => (
          <option key={item.name} value={item.name}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        value={op}
        onChange={(event) => onOp(event.target.value as RuleOp)}
        className="plaque-field min-h-11 bg-paper px-3 text-sm"
      >
        <option value="contains">contains</option>
        <option value="eq">equals</option>
        <option value="gt">greater than</option>
        <option value="lt">less than</option>
        <option value="empty">is empty</option>
        <option value="notempty">is not empty</option>
      </select>
      {op === "empty" || op === "notempty" ? null : (
        <input
          value={value}
          onChange={(event) => onValue(event.target.value)}
          className="plaque-field min-h-11 w-36 px-3 text-sm"
        />
      )}
      <button onClick={() => onAdd(column)} className="plaque min-h-11 px-4 text-sm">
        Filter
      </button>
    </>
  );
}

function fileTitle(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem || "Imported";
}

function isDuckDb(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[8] === 0x44 &&
    bytes[9] === 0x55 &&
    bytes[10] === 0x43 &&
    bytes[11] === 0x4b
  );
}

function storedValue(text: string, type: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isNumericType(type) && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/BOOL/i.test(type)) return /^(1|true|yes)$/i.test(trimmed);
  return trimmed;
}

function ruleLabel(op: RuleOp): string {
  if (op === "eq") return "=";
  if (op === "contains") return "contains";
  if (op === "gt") return ">";
  if (op === "lt") return "<";
  if (op === "empty") return "is empty";
  return "is not empty";
}

function isWrite(statement: string): boolean {
  return /^(insert|update|delete|create|drop|alter|copy|attach|detach|truncate|grant|revoke|call|install|load|export|import|vacuum|begin|commit|rollback)\b/i.test(
    statement.trim(),
  );
}

function geoColumns(meta: TableMeta | undefined): { lat: string; lon: string } | null {
  if (!meta) return null;
  const lat = meta.columns.find((column) => /^(lat|latitude)$/i.test(column.name));
  const lon = meta.columns.find((column) => /^(lon|lng|long|longitude)$/i.test(column.name));
  if (!lat || !lon) return null;
  return { lat: lat.name, lon: lon.name };
}
