# Carrel

A local analytical desk in the browser. Open a CSV, JSON, Parquet, or SQLite file, or start from a shipped sample, and look through it with search, facets, SQL, charts, and a map. The database stays in this browser. Nothing is uploaded.

Carrel is not a copy of [Datasette](https://datasette.io). It is a separate program that borrows the idea of a table you can facet, query, and export, then keeps the file on the machine in front of you.

## What you can do

- Browse tables, filter them, and open a row.
- Run SQL, including saved queries and named parameters such as `:city`.
- Turn on editing in Settings, then change cells in the grid the way you would in a spreadsheet, or insert, update, and delete from SQL.
- Create an empty database, or switch among the desks that ship with the app: Carrel, Bindery, Observatory, and Ledger.
- Chart a pair of columns, and map a table that has latitude and longitude.
- Export or copy the page you are looking at, or view that page as JSON.
- Install it as a progressive web app.

## Why this license

The code in this repository is released under the [MIT License](LICENSE). MIT is a short permissive license: you can use, change, and share the program, including in private, as long as you keep the copyright notice.

Datasette is a different project and is **not** included here. Datasette is licensed under the Apache License 2.0 by Simon Willison. If you use Datasette itself, follow that license. The MIT license on Carrel covers only Carrel.

If you would rather use another license, say so and the file can be changed before other people rely on it.

## Inspiration and attribution

The desk is named for a library carrel: a small place to sit with a text.

- **[Datasette](https://datasette.io)** by [Simon Willison](https://simonwillison.net). The table browser, facets, canned queries, per-table notes, a JSON view of the current rows, and the habit of treating a database file as something you explore rather than an application you build first. Datasette plugins such as [datasette-copyable](https://github.com/simonw/datasette-copyable), the cluster map, and cell renderers for images and Markdown suggested behavior that Carrel reimplemented for a page with no server. Datasette’s own source is Apache-2.0 and is not vendored in this repository.
- **[DuckDB](https://duckdb.org)** and **[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm)** (MIT). The analytical engine, including CSV, JSON, and Parquet, and the Origin Private File System file that survives a reload.
- **[sql.js](https://github.com/sql-js/sql.js)** (MIT). Reads an uploaded SQLite file in the browser so its tables can be copied into DuckDB. sql.js is SQLite compiled to WebAssembly; SQLite has its own terms.
- **[Leaflet](https://leafletjs.com)** (BSD-2-Clause) for the map.
- **[Recharts](https://recharts.org)** (MIT) for the charts.
- **[TanStack Start](https://tanstack.com/start)** and **[TanStack Router](https://tanstack.com/router)** (MIT) for the application shell.
- **[React](https://react.dev)** (MIT) and **[Lucide](https://lucide.dev)** (ISC) for the interface.

Sample rows are illustrative. Populations, capacities, and the short shelf of books are there so the desk is not empty on the first visit. They are not a dataset you should cite.

## Run it

```bash
npm install
npm run dev
```

The dev server listens on port 8080. `npm run build` produces the production build, and `npm run typecheck` checks the TypeScript.

`package.json` sets `"private": true` so this package is not published to npm. The GitHub repository is public; the npm registry is a separate step.
