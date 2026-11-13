/**
 * MezoGuard monitor worker. Long-running on Render (primary); `--once` runs a single cycle and exits.
 *   npm run worker        # loop every MONITOR_INTERVAL_SECONDS (default 60)
 *   npm run worker:once   # one cycle; exit code 0 = ok/partial, 1 = error/skipped
 * Needs DATABASE_URL (Postgres) or MEZOGUARD_DB=pglite. Applies schema.sql on start (idempotent).
 * Logs are one JSON object per line. SIGINT/SIGTERM finish the current cycle, then exit.
 */
import fs from "node:fs";

// Load .env files for local runs (Render/Vercel inject env directly). Never overrides existing vars.
for (const f of [".env.local", ".env"]) {
  try {
    if (fs.existsSync(f)) process.loadEnvFile(f);
  } catch {
    /* ignore malformed env file */
  }
}

async function main() {
  const { getDb } = await import("@/lib/server/db");
  const { migrate } = await import("@/lib/server/db/migrate");
  const { runMonitorCycle } = await import("@/lib/server/monitor");
  const { intervalSeconds } = await import("@/lib/server/dto");
  const { log } = await import("@/lib/server/log");

  const once = process.argv.includes("--once");
  const interval = intervalSeconds();
  const db = getDb();
  if (!db) {
    log.error("no database configured — set DATABASE_URL or MEZOGUARD_DB=pglite");
    process.exit(1);
  }
  await migrate(db);
  log.info("worker start", { mode: once ? "once" : "loop", intervalSeconds: interval, driver: db.kind });

  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutdown requested", { signal: sig });
    wake?.();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  let lastStatus = "ok";
  do {
    const t0 = Date.now();
    const report = await runMonitorCycle({ db });
    lastStatus = report.status;
    log.info("cycle", { ...report });
    if (once || stopping) break;
    const wait = Math.max(1000, interval * 1000 - (Date.now() - t0));
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, wait);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
  } while (!stopping);

  await db.close();
  log.info("worker stopped", { lastStatus });
  process.exit(once && (lastStatus === "error" || lastStatus === "skipped") ? 1 : 0);
}

main().catch((e) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "worker crashed", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
