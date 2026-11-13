/**
 * Database access. Two drivers behind one tiny interface:
 *  - Postgres via postgres.js when DATABASE_URL is set (Supabase/Neon in prod).
 *  - PGlite (embedded Postgres 17, WASM) at PGLITE_DIR (default .data/pglite) when MEZOGUARD_DB=pglite.
 *  - Neither → getDb() returns null: DB features are disabled; the read-only portfolio still works.
 *
 * Type normalisation (both drivers): numeric → string, int8 → string, timestamptz → Date, jsonb → object.
 * Always pass jsonb params as JSON text with `$n::text::jsonb` (postgres.js would double-encode a string param
 * typed jsonb) and arrays as Postgres literals via `pgTextArray()` with `$n::text::text[]`.
 */
import "../guard";
import postgres from "postgres";

export type Row = Record<string, unknown>;

export interface Db {
  readonly kind: "postgres" | "pglite";
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sqlText: string): Promise<void>;
  /** Runs fn in a transaction. Inside fn, use ONLY the tx handle (PGlite serialises on one connection). */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---------- postgres.js ----------
type PgSql = postgres.Sql<Record<string, never>>;
type PgTx = postgres.TransactionSql<Record<string, never>>;

function wrapPostgres(sql: PgSql | PgTx, isTx: boolean, root: PgSql): Db {
  const db: Db = {
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return [...rows] as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (isTx) return fn(db);
      return (await root.begin((tx) => fn(wrapPostgres(tx, true, root)))) as T;
    },
    async close() {
      if (!isTx) await root.end({ timeout: 5 });
    },
  };
  return db;
}

/**
 * Optional Postgres schema for every MezoGuard table (DB_SCHEMA, e.g. "mezoguard"), for databases shared with other
 * apps. Sent as the search_path startup parameter, which Supabase's pooler honours in session and transaction mode.
 */
export function dbSchema(): string | null {
  const s = process.env.DB_SCHEMA?.trim();
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error("DB_SCHEMA must be a lower-case SQL identifier");
  return s;
}

export function createPostgresDb(url: string): Db {
  const schema = dbSchema();
  const sql = postgres(url, {
    ...(schema ? { connection: { search_path: schema } } : {}),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Supabase/Neon poolers in transaction mode don't support named prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    // postgres.js already returns int8 and numeric as strings.
  }) as unknown as PgSql;
  return wrapPostgres(sql, false, sql);
}

// ---------- PGlite ----------
interface PgliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query<R>(t: string, p?: unknown[]): Promise<{ rows: R[] }>; exec(t: string): Promise<unknown> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const PG_INT8 = 20;
const PG_NUMERIC = 1700;

/**
 * PGlite is imported lazily and hidden from the Next bundler (it ships WASM + data files that must be loaded from
 * node_modules at runtime). `dataDir` may be "memory://" for tests.
 */
export function createPgliteDb(dataDir: string, opts: { autoMigrate?: boolean } = {}): Db {
  let instance: Promise<PgliteLike> | null = null;
  const open = () => {
    if (!instance) {
      instance = (async () => {
        const specifier = "@electric-sql/pglite";
        const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)) as {
          PGlite: new (dir?: string, o?: unknown) => PgliteLike;
        };
        if (dataDir !== "memory://" && !dataDir.startsWith("idb://")) {
          const fs = await import("node:fs");
          fs.mkdirSync(dataDir, { recursive: true });
        }
        const pg = new mod.PGlite(dataDir, {
          parsers: { [PG_INT8]: (x: string) => x, [PG_NUMERIC]: (x: string) => x },
        });
        if (opts.autoMigrate) {
          const { schemaSql } = await import("./migrate");
          await pg.exec(await schemaSql());
        }
        return pg;
      })();
    }
    return instance;
  };
  type TxLike = { query<R>(t: string, p?: unknown[]): Promise<{ rows: R[] }>; exec(t: string): Promise<unknown> };
  const wrapTx = (tx: TxLike): Db => {
    const d: Db = {
      kind: "pglite",
      async query<T>(text: string, params: unknown[] = []) {
        return (await tx.query<T>(text, params)).rows;
      },
      async exec(text: string) {
        await tx.exec(text);
      },
      async transaction<T>(fn: (t: Db) => Promise<T>) {
        return fn(d);
      },
      async close() {},
    };
    return d;
  };
  return {
    kind: "pglite",
    async query<T>(text: string, params: unknown[] = []) {
      return (await (await open()).query<T>(text, params)).rows;
    },
    async exec(text: string) {
      await (await open()).exec(text);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return (await open()).transaction((tx) => fn(wrapTx(tx)));
    },
    async close() {
      if (instance) await (await instance).close();
      instance = null;
    },
  };
}

// ---------- singleton ----------
const g = globalThis as unknown as { __mezoguardDb?: Db | null; __mezoguardDbKey?: string };

export function dbMode(): "postgres" | "pglite" | "disabled" {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.MEZOGUARD_DB === "pglite") return "pglite";
  return "disabled";
}

function envKey(): string {
  const mode = dbMode();
  return mode === "pglite" ? `pglite:${process.env.PGLITE_DIR ?? ".data/pglite"}` : mode;
}

/** Returns the process-wide DB handle, or null when no database is configured. */
export function getDb(): Db | null {
  const key = envKey();
  if (g.__mezoguardDb !== undefined && g.__mezoguardDbKey === key) return g.__mezoguardDb;
  const mode = dbMode();
  let db: Db | null = null;
  if (mode === "postgres") db = createPostgresDb(process.env.DATABASE_URL!);
  else if (mode === "pglite") db = createPgliteDb(process.env.PGLITE_DIR ?? ".data/pglite", { autoMigrate: true });
  g.__mezoguardDb = db;
  g.__mezoguardDbKey = key;
  return db;
}

/** Test hook: force a specific handle (or null) as the process DB for the current env. */
export function setDb(db: Db | null): void {
  g.__mezoguardDb = db;
  g.__mezoguardDbKey = envKey();
}

/** `["a","b"]` → `{"a","b"}` (use with `$n::text::text[]`). */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`;
}
