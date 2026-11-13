/** Structured JSON logs (one line per event). Never pass secrets in fields; `redact` strips known env secrets anyway. */
import "./guard";

type Fields = Record<string, unknown>;
const SECRET_KEYS = ["SESSION_SECRET", "CRON_SECRET", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "DATABASE_URL"];

function scrub(s: string): string {
  let out = s;
  for (const k of SECRET_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  return out;
}

function emit(level: "debug" | "info" | "warn" | "error", msg: string, fields: Fields = {}) {
  if (level === "debug" && !process.env.MEZOGUARD_DEBUG) return;
  if (process.env.MEZOGUARD_LOG === "silent") return;
  const line = scrub(
    JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Fields) => emit("debug", m, f),
  info: (m: string, f?: Fields) => emit("info", m, f),
  warn: (m: string, f?: Fields) => emit("warn", m, f),
  error: (m: string, f?: Fields) => emit("error", m, f),
};
