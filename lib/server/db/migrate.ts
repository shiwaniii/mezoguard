/**
 * Applies lib/server/db/schema.sql. Every statement in the schema is `create … if not exists` / `on conflict do
 * nothing`, so this is idempotent and safe to run on every worker start. `gen_random_uuid()` is built into
 * Postgres 13+ and PGlite (PG 17) — verified, no pgcrypto extension needed.
 *
 * CLI: `npm run db:migrate` (uses DATABASE_URL or MEZOGUARD_DB=pglite).
 */
import "../guard";
import fs from "node:fs/promises";
import path from "node:path";
import { dbSchema, getDb, type Db } from "./index";

let cached: string | null = null;

export async function schemaSql(): Promise<string> {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), "lib/server/db/schema.sql"),
    typeof __dirname !== "undefined" ? path.join(__dirname, "schema.sql") : "",
  ].filter(Boolean);
  let lastErr: unknown;
  for (const file of candidates) {
    try {
      cached = await fs.readFile(file, "utf8");
      return cached;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`schema.sql not found (${candidates.join(", ")}): ${String(lastErr)}`);
}

export async function migrate(db: Db): Promise<void> {
  const schema = db.kind === "postgres" ? dbSchema() : null;
  if (schema) await db.exec(`create schema if not exists ${schema}`);
  await db.exec(await schemaSql());
}

async function main() {
  const db = getDb();
  if (!db) {
    console.error(JSON.stringify({ level: "error", msg: "no database configured (set DATABASE_URL or MEZOGUARD_DB=pglite)" }));
    process.exit(1);
  }
  await migrate(db);
  const tables = await db.query<{ n: string }>(
    "select count(*)::text as n from information_schema.tables where table_schema = current_schema()",
  );
  console.log(JSON.stringify({ level: "info", msg: "migrated", driver: db.kind, tables: Number(tables[0]?.n ?? 0) }));
  await db.close();
}

const isMain = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (isMain) {
  main().catch((e) => {
    console.error(JSON.stringify({ level: "error", msg: "migration failed", error: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  });
}
