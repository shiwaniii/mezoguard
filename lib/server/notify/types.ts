import "../guard";

export type ChannelResult =
  | { status: "sent"; providerId?: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; retryable: boolean };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Redact secrets that might appear in provider error text (bot token in URLs, API keys). */
export function redact(s: string): string {
  let out = s;
  for (const k of ["TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "SESSION_SECRET", "CRON_SECRET"]) {
    const v = process.env[k];
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot[redacted]").slice(0, 500);
}

export const isRetryableStatus = (status: number) => status === 429 || status >= 500;
