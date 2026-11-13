/** Telegram Bot API sendMessage. The bot token is never logged (URLs are redacted in errors). */
import "../guard";
import { redact, isRetryableStatus, type ChannelResult, type FetchLike } from "./types";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegram(chatId: string | null, text: string, fetchImpl: FetchLike = fetch): Promise<ChannelResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { status: "skipped", reason: "Telegram not configured on server (TELEGRAM_BOT_TOKEN unset)" };
  if (!chatId) return { status: "skipped", reason: "no Telegram chat id in user settings" };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!res.ok || body.ok === false) {
      return { status: "failed", error: redact(`telegram ${res.status}: ${body.description ?? res.statusText}`), retryable: isRetryableStatus(res.status) };
    }
    return { status: "sent", providerId: body.result?.message_id !== undefined ? String(body.result.message_id) : null };
  } catch (e) {
    return { status: "failed", error: redact(`telegram network error: ${e instanceof Error ? e.message : String(e)}`), retryable: true };
  }
}
